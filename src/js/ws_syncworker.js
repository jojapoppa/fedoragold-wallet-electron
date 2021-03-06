/* eslint no-empty: 0 */
"use strict";

const log = require('electron-log');
const WalletShellApi = require('./ws_api');
const { setIntervalAsync } = require('set-interval-async/fixed');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const killer = require('tree-kill');
const platform = require('os').platform();

let DEBUG=false;
//log.transports.file.maxSize = 5 * 1024 * 1024;
//log.transports.console.level = 'debug';
//log.transports.file.level = 'debug';

const CHECK_INTERVAL = 900; // how often we get info from fedoragold_walletd
var bSynchedMode = false;
var heightVal = 0;
var knownBlockCount = 0;
var LAST_HEIGHTVAL = 1;
var LAST_BLOCK_COUNT = 1;
var SERVICE_CFG = { daemon_host: '127.0.0.1', daemon_port: '31875', walletd_host: '127.0.0.1',
  walletd_port: '31876', walletd_password: 'xxx', remote_daemon: 'false', mining_port: '3333',
  cjdnsadmin_port: '11234', cjdnsudp_port: '49869', cjdnsbeacon_port: '64512', cjdnssocks5_port: '1080'};
var TX_LAST_INDEX = 1;
var TX_LAST_COUNT = 0;
var TX_CHECK_STARTED = false;
var TX_SKIPPED_COUNT = 0;
var STATE_CONNECTED = false;
var STATE_SAVING = false;
var STATE_PAUSED = false;

//global.syncNowTime = Math.floor(Date.now());
//global.syncPrevTimeStamp = Math.floor(Date.now());

var wsapi = null;
var balanceTaskWorker = null;
var heightTaskWorker = null; 
var saveTaskWorker = null;
var blockTaskWorker = null;
var transactionTaskWorker = null;
var daemonsynchronizedok = false;

function logDebug(msg){
    //if(!DEBUG) return;
    console.log(`[syncworker] ${msg}`);
}

function peerMsg(peerCount) {
  // Activates the "pause" symbol in the UI - show that network is disconnected
  var peerMsg = " Peers: "+peerCount+" (1 minimum required)";
  let fakeStatus = {
    blockCount: -50,
    displayBlockCount: -50,
    displayKnownBlockCount: -50,
    syncPercent: -50,
    knownBlockCount: -50,
    uiMessage: peerMsg
  };

  process.send({ type: 'blockUpdated', data: fakeStatus });

  STATE_CONNECTED = false;
}

function splitLines(t) { return t.split(/\r\n|\r|\n/); }
function checkWalletdStatus(heightVal, knownBlockCount) {
  var cmd = `ps -ex`;
  switch (process.platform) {
      case 'win32' : cmd = `tasklist`; break;
      case 'darwin' : cmd = `ps -ax`; break;
      case 'linux' : cmd = `ps -A`; break;
      default: break;
  }

  // the x: 0 is a workaround for the ENOMEM bug in nodejs: https://github.com/nodejs/node/issues/29008
  var procStr = '';
  var status = false;
  let stdout = execSync(cmd, {
      maxBuffer: 2000 * 1024,
      env: {x: 0}
  }); //, function(error, stdout, stderr) {
    //if (error) { return; } else if (stderr.length > 0) { return; }

    var procID = 0;
    procStr = stdout.toString();
    procStr = procStr.replace(/[^a-zA-Z0-9_ .:;,?\n\r\t]/g, "");
    procStr = procStr.toLowerCase();

    var procAry = splitLines(procStr);
    procStr = "";
    var dloc = procAry.findIndex(element => element.includes('fedoragold_wall'))
    if (dloc >= 0) {
      procStr = procAry[dloc];
      let procStr2 = '';
      dloc = procStr.indexOf('fedoragold_wall');
      //logDebug("procStr: "+procStr);
      //logDebug("dloc: "+dloc);
      if (platform === 'win32') {
        procStr2 = procStr.substring(dloc+27);
      } else if (platform === 'darwin') {
        procStr2 = procStr.substring(0, 6);
      } else {
        procStr2 = procStr.substring(0, 8);
      }

      procStr2 = procStr2.trim();
      //logDebug("procStr2: "+procStr2);
      if (platform === 'win32') {
        procID = parseInt(procStr2.substr(0, procStr2.indexOf(' ')), 10);
      } else {
        procID = parseInt(procStr2, 10);
      }
    }

//    global.syncNowTime = Math.floor(Date.now());
//    let diffTime = global.syncNowTime-global.syncPrevTimeStamp;
//    if (diffTime > 180000) {
//      global.syncPrevTimeStamp = Math.floor(Date.now());
//      logDebug("walletd restarting...");
//      try{killer(procID,'SIGKILL');}catch(err){/*do nothing*/}
//    }

    let dif = heightVal-knownBlockCount;
    //logDebug("test heights at walletd PID: "+procID);
    //logDebug(" diff is: "+dif);
    if (dif > 10 && (dif % 10 == 0)) {
      logDebug("restart walletd at procID: "+procID);
      if (procID > 0) try{killer(procID,'SIGKILL');}catch(err){/*do nothing*/}
      logDebug("walletd restarting because no blocks synched, will restart and retry...");
    } 
//  });
}

function checkBlockUpdate() {

    var retVal = true;
    if (STATE_SAVING || wsapi === null || STATE_PAUSED) {
      //logDebug("checkBlockUpdate(): invalid state ... skipped");
      //if (STATE_SAVING) logDebug(" ... reason: STATE_SAVING");
      //if (wsapi === null) logDebug(" ... reason: wsapi === null");
      //if (STATE_PAUSED) logDebug(" ... reason: STATE_PAUSED");
      return false;
    }

    // only start work once daemon is ready to work with walletd
    //if (! daemonsynchronizedok) {
    //  logDebug("checkBlockUpdate() ... not synched");
    //  return false;
    //}

    wsapi.getStatus().then((bStatus) => {

        //logDebug(`blockStatus: ${JSON.stringify(bStatus)}`);
        //global.syncPrevTimeStamp = Math.floor(Date.now());

        if (bStatus.id.length <= 0) return false;
        if (bStatus.result === undefined) return false;
        let blockStatus = bStatus.result;

        STATE_CONNECTED = true;
        let kbcReturn = 0;
        if (blockStatus.knownBlockCount !== undefined)
          kbcReturn = blockStatus.knownBlockCount-1;

        // jojapoppa, later show a "signal" like what you see on a cell phone with the bars...
        let peerCount = 0;
        if (blockStatus.peerCount !== undefined)
          peerCount = blockStatus.peerCount;

        if ((peerCount < 1) || (kbcReturn < 100)) {
          //logDebug("bad network connection...");
          peerMsg(peerCount);
          retVal = false;
        } else { 
          //logDebug(`blockstatus: ${JSON.stringify(blockStatus)}`);
          knownBlockCount = kbcReturn;
        }
            
        if (retVal) {
          //logDebug("good network connection..."); // we have good connection
          let blockCount = 0;
          if (blockStatus.blockCount !== undefined)
            blockCount = blockStatus.blockCount-1;

          //logDebug("blockCount reported: "+blockCount);
          //logDebug("knownBlockCount reported: "+knownBlockCount);
          LAST_HEIGHTVAL = heightVal;
          LAST_BLOCK_COUNT = blockCount;

          // add any extras here, so renderer is not doing too many things
          let dispKnownBlockCount = (knownBlockCount-1);
          let dispBlockCount = (blockCount>dispKnownBlockCount ? dispKnownBlockCount : blockCount);
          let syncPercent = 0;
          if (heightVal < (dispKnownBlockCount-2)) {
            syncPercent = ((heightVal / dispKnownBlockCount) * 100);
          }
          else {
            syncPercent = ((dispBlockCount / dispKnownBlockCount) * 100);
          }
          if(syncPercent <=0 || syncPercent >= 99.995){
            syncPercent = 100;
          }else{
            syncPercent = syncPercent.toFixed(2);
          }

          if (syncPercent == 100) {
            bSynchedMode = true;
          } else {
            bSynchedMode = false;
          }

          blockStatus.displayDaemonHeight = heightVal;
          blockStatus.displayBlockCount = blockCount;
          blockStatus.displayKnownBlockCount = knownBlockCount;
          blockStatus.uiMessage = '';
          blockStatus.syncPercent = syncPercent;

          //logDebug(`sending blockstatus: ${JSON.stringify(blockStatus)}`);
          process.send({
            type: 'blockUpdated',
            data: blockStatus
          });
        }
    }).catch((err) => {
      // just eat this as the connection with Daemon can be intermittent
      retVal = false;
    });

    return retVal;
}

function reset() {
  if (wsapi === null)
    return;

  TX_CHECK_STARTED = false;
  try {
    wsapi.reset({});
  } catch(e) {}

  process.send({
    type: 'walletReset',
    data: ''
  });

  logDebug("wallet reset...");
}

var queue = [];
let blockMargin = 10;
function sendTransactionsRequest(s_trx_args) {
  var retVal = true;

  let syncPercent = (LAST_BLOCK_COUNT / knownBlockCount) * 100;
  if (syncPercent <=0 || syncPercent >= 99.995)
    syncPercent = 100;
  //logDebug("syncPercent: "+syncPercent);
  if (syncPercent < 98) {
    if (!queue.includes(s_trx_args)) queue.push(s_trx_args);
    return true;
  }

  wsapi.getTransactions(JSON.parse(s_trx_args)).then(function(trx) {
    let blockItemsLength = 0;
    if (trx.items !== undefined && trx.items.length !== undefined)
      blockItemsLength = trx.items.length;
    if (trx.items == null) {
      if (!queue.includes(s_trx_args)) {
        queue.push(s_trx_args);
        retVal = false;
      }
      return;
    } else if ((s_trx_args.blockCount > blockItemsLength) && !queue.includes(s_trx_args)) {
      // Partial success
      if (s_trx_args.blockCount-blockItemsLength > 2*blockMargin) queue.push(s_trx_args);
    } 

    //logDebug(`getTransactions: args=${JSON.stringify(s_trx_args)} returned: ${blockItemsLength} queue: ${queue.length}`);

    var bitems = { type: 'transactionUpdated', data: trx.items };
    var statTxt = JSON.stringify(s_trx_args) + " ret: " + blockItemsLength + " queue: " + queue.length;
    var sitems = { type: 'transactionStatus', data: statTxt };

    var bitemskept = { type: 'transactionUpdated', data: []};
    Array.from(bitems.data).forEach((bitem) => {
      bitem.transactions.map((bitemtx) => {
        if (bitemtx.amount !== 0) {
          //logDebug("pushing bitem amount: "+bitemtx.amount);
          bitemskept.data.push(bitem);
        }
      });
    });

    //logDebug(`bitems: ${JSON.stringify(bitemskept)}`);

    var prom = new Promise(function(resolve, reject) {
      process.send(bitemskept);
      process.send(sitems);
      resolve(true);
    }).catch(function (err) { 
      if (!queue.includes(s_trx_args)) queue.push(s_trx_args);
      retVal = false; 
    });

    // make it easier for memory manager to free up memory after sending to async process...
    bitems = null;
  }, function(err) { 
    if (!queue.includes(s_trx_args)) queue.push(s_trx_args);
    retVal = false; 
  });

  // This allows memory garbage collector to clean up ...
  if (queue.length == 0) queue = [];

  return retVal;
}

function checkBalanceUpdate() {

  if (!STATE_CONNECTED || wsapi === null || STATE_PAUSED || STATE_SAVING) {
    //logDebug("checkBalanceUpdate(): invalid state ... skipped");
    //if (STATE_SAVING) logDebug(" ... reason: STATE_SAVING");
    //if (wsapi === null) logDebug(" ... reason: wsapi === null");
    //if (STATE_PAUSED) logDebug(" ... reason: STATE_PAUSED");
    return false;
  }

  //logDebug("getBalance...");
  try {
    wsapi.getBalance().then((balance) => {
    
      //let bal = "Balance: " + parseFloat(balance.availableBalance);
      //logDebug("getBalance got: "+bal);

      process.send({
        type: 'balanceUpdated',
        data: balance
      });
    }).catch((err) => {
      // just eat the message, there will be timeouts and that's normal
      //logDebug(`checkBalanceUpdate: getBalance FAILED, ${err.message}`);
    //process.send({type: 'debug', data: {uiMessage: err.message} });
    });
  } catch(e) { /* do nothing... server connecting */ }
}

let chunk=4000; // chunks of 10k are too much for the local daemon (remote is okay)
let chunkCnt=3;
let lastGetTransactionsTimestamp = 0;
function updateTransactionsList(startIndexWithMargin, requestNumBlocks) {

  // send the blocks in groups of 10,000 so that you don't
  //   overwhelm the msg buffer and slow the UI down.
  for (var i=0;i<requestNumBlocks;i+=chunk) {

    // handle 'chunkCnt' chunks at a time, otherwise we choke network input buffer
    //   especially true when the wallet is running 'thin'
    if (i > (chunkCnt*chunk)) {
      TX_LAST_INDEX += chunk;
      break;
    }

    var trx_args = {};
    if (requestNumBlocks<=chunk) {
      trx_args = {
        firstBlockIndex: startIndexWithMargin,
        blockCount: requestNumBlocks
      };
    } else {
      var rq = chunk;
      var chend = i+chunk;
      if (chend>(requestNumBlocks-1)) { rq = (requestNumBlocks-1)-i; }
      trx_args = {
        firstBlockIndex: startIndexWithMargin+i,
        blockCount: rq
      };
    }

    // return values don't matter as the getTransactions Promise
    // has it's own 'thread', so we just set TX_LAST_INDEX instead
    TX_LAST_INDEX = trx_args.firstBlockIndex; // force system to retry this way...
    if (!queue.includes(JSON.stringify(trx_args))) queue.push(JSON.stringify(trx_args));
    var s_trx_args = queue.shift();
    if (!sendTransactionsRequest(s_trx_args)) {
      return false;
    } else {
      for (var tries=0; (queue.length>0) && (tries<3); tries++) {
        s_trx_args = queue.shift();
        if (s_trx_args != null) {
          // as errors happen, and things get put on the queue, this double
          // check allows us to eventually catch up again...
          if (!sendTransactionsRequest(s_trx_args)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

function checkTransactionsUpdate(){
  if(STATE_SAVING || !STATE_CONNECTED || wsapi === null || STATE_PAUSED || !bSynchedMode ) return false;

    if (! STATE_CONNECTED) {
      // walletd's network access to fedoragold_daemon is down...
      return false;
    }

    //logDebug("+++ checkTransactionsUpdate() start...");

    if (LAST_BLOCK_COUNT > 1) {
      //logDebug('checkTransactionsUpdate: checking tx update');
      let currentBlockCount = LAST_BLOCK_COUNT-1;
      let startIndex = (!TX_CHECK_STARTED ? 1 : TX_LAST_INDEX);
      let searchCount = currentBlockCount;
      let needCountMargin = false;
      if (TX_CHECK_STARTED) {
        needCountMargin = true;
        if (currentBlockCount > TX_LAST_COUNT) {
          searchCount = (currentBlockCount - TX_LAST_COUNT);
        }
        else {
          searchCount = 0;
        }
      }

      let startIndexWithMargin = (startIndex === 1 ? 1 : (startIndex-blockMargin));
      let searchCountWithMargin = needCountMargin ?  
        searchCount+blockMargin : searchCount;

      // ask for a little more than you think is likely avail
      // walletd can always just send back less if it hasn't synced
      // to that height yet.  this keeps the ave req amount
      // from gradually diminishing over time, as the amt requested
      // is based on the amount received in the last response
      let requestNumBlocks = searchCountWithMargin;
      if (requestNumBlocks < (chunk-blockMargin)) { 
        requestNumBlocks += blockMargin;

        // special case at the very end of the chunking algo
        // causes it to taper off to find the overlap for end of blocks
        // at the very end of the taper it will briefly jump past the
        // top block, and then backtrack with the optimal overlap
        if (requestNumBlocks > ((2*blockMargin)+1)) {
          startIndexWithMargin += searchCount;
        }

        // this stops it from blowing past the top block at the end
        if (startIndexWithMargin >= (knownBlockCount-1)) {
          startIndexWithMargin = knownBlockCount-blockMargin;
          requestNumBlocks = 2*blockMargin;
        }
      }

      // will be reset if any getTransactions Promises fail
      //  which happens on a different thread...
      TX_LAST_INDEX = currentBlockCount;

      //logDebug("updateTransactionsList to be called");
      var promo = new Promise(function(resolve, reject) {
        if (!updateTransactionsList(startIndexWithMargin, requestNumBlocks)) {
          TX_LAST_INDEX = TX_LAST_INDEX - requestNumBlocks;
        }
        resolve(true);
      }).catch(function (err) {logDebug("updateTransactionList: "+err);});

      //logDebug("updateTransactionsList returned");

      TX_CHECK_STARTED = true;

      // detects if you are at the end of a multi-chunk request 
      if (requestNumBlocks > chunk) {
        TX_LAST_COUNT = TX_LAST_INDEX;
      } else { 
        TX_LAST_COUNT = TX_LAST_INDEX + requestNumBlocks;
        TX_LAST_INDEX += requestNumBlocks;
        //logDebug("TX_LAST_INDEX: "+TX_LAST_INDEX);
        //logDebug("TX_LAST_COUNT: "+TX_LAST_COUNT);
      }
    }

  //logDebug("+++check transactionsupdate completed");
  return true;
}

function delayReleaseSaveState(){
    setTimeout(() => {
        STATE_SAVING = false;
        //logDebug("saveWallet: reset");
    }, 3000);
}

function checkHeight() {
  checkWalletdStatus(heightVal, knownBlockCount);

  if(STATE_PAUSED || wsapi === null || !STATE_CONNECTED) return;
  //logDebug("syncworker: checkHeight");

  wsapi.getHeight().then((htval) => {
    heightVal = htval.height; //parseInt(result.height, 10);
    //logDebug("syncworker checkHeight: "+heightVal);
  }).catch((err) => {
    //just eat this... sometimes daemon takes a while to start...
    //logDebug(`synchworker getHeight from Daemon: FAILED, ${err.message}`);
  });
}

function saveWallet(){

    if(wsapi === null || STATE_PAUSED || !STATE_CONNECTED || !bSynchedMode) return false;
    if(STATE_SAVING){
        //logDebug('saveWallet: skipped, last save operation still pending');
        return false;
    }
    STATE_SAVING = true;
    //logDebug(`saveWallet: trying to save wallet`);

    var retVal = true;
    delayReleaseSaveState();

    wsapi.save().then(()=> {
      //logDebug(`saveWallet: OK`);
      STATE_SAVING = false;
      retVal = true;
    }).catch((err)=>{
      STATE_SAVING = false;
      //just eat the message, they won't all succeed... expected behavior
      //logDebug(`saveWallet: FAILED, ${err.message}`);
      retVal = false;
    });

    return retVal;
}

heightTaskWorker = setIntervalAsync(()=>{
  checkHeight();
}, 900*2.75);

balanceTaskWorker = setIntervalAsync(()=>{
  checkBalanceUpdate();
}, 900*2);

transactionTaskWorker = setIntervalAsync(()=>{
  checkTransactionsUpdate();
}, 900*3.5);

blockTaskWorker = setIntervalAsync(()=>{
  checkBlockUpdate();
}, 900*2.75);

saveTaskWorker = setIntervalAsync(()=>{
  saveWallet();
}, 900*200);

// {type: 'blah', msg: 'any'}
process.on('message', (msg) => {
    let cmd = msg || '';
    cmd.type = msg.type || '';
    cmd.data = msg.data || null;

    switch (cmd.type) {
        case 'start':
            STATE_PAUSED = false;
            SERVICE_CFG = cmd.data;

            //logDebug("syncworker: in wallet start");

            var prmapi = new Promise(function(resolve, reject) {
              wsapi = new WalletShellApi(SERVICE_CFG);
              wsapi.walletdRunning = true;
              //logDebug("CREATED WSAPI in SyncWorker");
              resolve(true); 
            }).catch(function(err){});
            //logDebug("got a start command: starting with localDaemonMode: "+!SERVICE_CFG.remote_daemon);
            var prm = new Promise(function(resolve, reject) {
              //process.send({
              //  type: 'daemonMode',
              //  data: !SERVICE_CFG.remote_daemon
              //});
              //logDebug("sent daemon mode");
              process.send({
                type: 'walletReset',
                data: '' 
              });
              //logDebug("start resolved");
              resolve(true);
            }).catch(function(err){});
            break;
        case 'checkHeight':
            checkHeight();
            break;
        case 'daemonsynchronizedok':
            //logDebug("synchronized ok set");
            daemonsynchronizedok = true;
            break;
        case 'checkBalanceUpdate':
            checkBalanceUpdate();
            break;
        case 'checkTransactionsUpdate':
            checkTransactionsUpdate();
            break;
        case 'checkBlockUpdate':
            checkBlockUpdate();
            break;
        case 'saveWallet':
            saveWallet();
            break; 
        case 'reset':
            reset();
            break;
        case 'pause':
            if(STATE_PAUSED) return;
            logDebug('Got suspend command');
            process.send({
                type: 'blockUpdated',
                data: {
                    blockCount: -50,
                    displayBlockCount: -50,
                    displayKnownBlockCount: -50,
                    syncPercent: -50,
                    knownBlockCount: -50,
                    uiMessage: ''
                }
            });
            STATE_PAUSED = true;
            break;
        case 'resume':
            logDebug('Got resume command');
            TX_SKIPPED_COUNT = 5;
            wsapi = new WalletShellApi(SERVICE_CFG);
            wsapi.walletdRunning = true;
            setTimeout(() => {
                wsapi.getBalance().then(() => {
                    logDebug(`Warming up: getBalance OK`);
                }).catch((err) => {
                    logDebug(`Warming up: getBalance FAILED, ${err.message}`);
                });
                STATE_PAUSED = false;
            }, 15000);

            process.send({
                type: 'blockUpdated',
                data: {
                    blockCount: -10,
                    displayBlockCount: -10,
                    displayKnownBlockCount: -10,
                    syncPercent: -10,
                    knownBlockCount: -10,
                    uiMessage: ''
                }
            });
            break;
        case 'stop':
            //logDebug('Got stop command, halting all tasks and exit...');
            TX_SKIPPED_COUNT = 0;
            //wsapi = null;
            //if (balanceTaskWorker === undefined || balanceTaskWorker === null){
                try{
                    clearInterval(balanceTaskWorker);
                    clearInterval(heightTaskWorker);
                    clearInterval(saveTaskWorker);
                    clearInterval(blockTaskWorker);
                    clearInterval(transactionTaskWorker);
                    wsapi = null;
                    process.exit(0);
                }catch(e){
                    logDebug(`FAILED, ${e.message}`);
                }
            //}
            break;
        default:
            break;
    }
});

process.on('uncaughtException', function (err) {
    // do nothing
    logDebug(`worker uncaughtException: ${err.message}`);
});

process.on('disconnect', () => function(){
    logDebug(`worker disconnected`);
    process.exit(1);
});

//logDebug("Finished: all synchworker process messagment defined...");

