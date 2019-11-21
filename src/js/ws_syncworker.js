/* eslint no-empty: 0 */

const log = require('electron-log');
const WalletShellApi = require('./ws_api');
const { setIntervalAsync } = require('set-interval-async/fixed');

let DEBUG=false;
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'debug';
log.transports.file.level = 'debug';

const CHECK_INTERVAL = 900; // how often we get info from fedoragold_walletd
var heightVal = 0;
var knownBlockCount = 0;
var LAST_HEIGHTVAL = 1;
var LAST_BLOCK_COUNT = 1;
var LAST_KNOWN_BLOCK_COUNT = 1;

var SERVICE_CFG = { daemon_host: '127.0.0.1', daemon_port: '31875', walletd_host: '127.0.0.1', walletd_port: '31876', walletd_password: 'xxx'};
var SAVE_COUNTER = 0;
var TX_LAST_INDEX = 1;
var TX_LAST_COUNT = 0;
var TX_CHECK_STARTED = false;
var TX_SKIPPED_COUNT = 0;
var STATE_CONNECTED = true;
var STATE_SAVING = false;
var STATE_PAUSED = false;
var STATE_PENDING_SAVE = false;
var PENDING_SAVE_SKIP_COUNTER = 0;
var PENDING_SAVE_SKIP_MAX = 5;

var wsapi = null;
var taskWorker = null;

function logDebug(msg){
    if(!DEBUG) return;
    log.debug(`[syncworker] ${msg}`);
}

function initApi(cfg){
    if(wsapi instanceof WalletShellApi) return;
    logDebug('Initializing WalletShellApi');
    SERVICE_CFG = cfg;
    wsapi = new WalletShellApi(SERVICE_CFG);
}

function checkBlockUpdate(){
    var retVal = true;
    //log.warn("checkBlockUpdate() called...");

    if(!SERVICE_CFG || STATE_SAVING || wsapi === null ) {
      logDebug('invalid State'); 
      return false;
    }
    if(STATE_PENDING_SAVE && (PENDING_SAVE_SKIP_COUNTER < PENDING_SAVE_SKIP_MAX)){
        logDebug('checkBlockUpdate: there is pending saveWallet, delaying block update check');
        PENDING_SAVE_SKIP_COUNTER += 1;
        return false;
    }

    PENDING_SAVE_SKIP_COUNTER = 0;

    wsapi.getStatus().then((blockStatus) => {
        STATE_PENDING_SAVE = false;
        let lastConStatus = STATE_CONNECTED;
        let kbcReturn = parseInt(blockStatus.knownBlockCount, 10) - 1;

        //log.warn(`blockstatus: ${JSON.stringify(blockStatus)}`);

        // jojapoppa
        // We should use this peercount to create a "Signal" display sort
        // of like what you see on a cell phone with the bars...
        //let peerCount = parseInt(blockStatus.peerCount, 10);
        //log.warn("peerCount is: " + peerCount);

        if (kbcReturn < 100) {

          // does this happen with network outages?
          //log.warn('checkBlockUpdate: Bad known block count, mark connection as broken');
          //if (lastConStatus !== conFailed) {
          //  let fakeStatus = {
          //    blockCount: -200,
          //    displayBlockCount: -200,
          //    displayKnownBlockCount: -200,
          //    syncPercent: -200,
          //    knownBlockCount: -200,
          //    uiMessage: ''
          //  };
          //  process.send({
          //    type: 'blockUpdated',
          //    data: fakeStatus
          //  });
          //}

          STATE_CONNECTED = false;
          log.warn("fedoragold_walletd cannot reach fedoragold network,");
          log.warn("  possible network interruption");

          // THIS NEEDS TO BE MADE DYNAMIC - AND RUN ON VPN
          // bind the daemon to a seed server address
          //wsapi.bindDaemon('18.222.96.134', 30159);

          retVal = false;
        } else {
          knownBlockCount = kbcReturn;
        }

        if (retVal) {
          logDebug("good network connection...");

          // we have good connection
          STATE_CONNECTED = true;
          let blockCount = parseInt(blockStatus.localDaemonBlockCount, 10);

          //log.warn("blockCount reported: "+blockCount);
          //log.warn("knownBlockCount reported: "+knownBlockCount);
          LAST_HEIGHTVAL = heightVal;
          LAST_BLOCK_COUNT = blockCount;

          if (knownBlockCount > LAST_KNOWN_BLOCK_COUNT) {
            LAST_KNOWN_BLOCK_COUNT = knownBlockCount;
          } else {
            knownBlockCount = LAST_KNOWN_BLOCK_COUNT;
          }

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

          logDebug("sending height value: "+heightVal);

          blockStatus.displayDaemonHeight = heightVal;
          blockStatus.displayBlockCount = blockCount;
          blockStatus.displayKnownBlockCount = knownBlockCount;
          blockStatus.uiMessage = '';
          blockStatus.syncPercent = syncPercent;
          process.send({
            type: 'blockUpdated',
            data: blockStatus
          });
        }
    }).catch((err) => {
        // just eat this as the connection with Daemon can be intermittent
        //log.warn(`checkBlockUpdate: FAILED, ${err.message}`);
        retVal = false;
    });

    //log.warn("returning from checkBlockUpdate");

    // isWalletdSynching
    return retVal;
}

function reset() {
  TX_CHECK_STARTED = false;
  try {
    wsapi.reset({});
  } catch(e) {}
}

function sendTransactionsRequest(trx_args) {

  var retVal = true;
  //log.warn(`getTransactions: args=${JSON.stringify(trx_args)}`);

  wsapi.getTransactions(trx_args).then(function(trx) {
    const blockItems = trx.items;

    var prom = new Promise(function(resolve, reject) {
      process.send({
        type: 'transactionStatus',
        data: JSON.stringify(trx_args)
      });
      process.send({
        type: 'transactionUpdated',
        data: blockItems
      });
      resolve(true);
    }).catch(function (err) {
      TX_LAST_INDEX = trx_args.firstBlockIndex; // force system to retry this way...
      retVal = false;
    });
  }, function(err) {

    // If walletd has not resynced to the top block, then it will fail when it tries
    //   to return transactions at its local top-block.  so setting TX_LAST_INDEX just
    //   makes the system attempt to get that failed local-to block again... until
    //   walletd is synched, when is when all of the blocks will have been returned
    TX_LAST_INDEX = trx_args.firstBlockIndex; // force system to retry this way...
    retVal = false;

    //log.warn("getTransactions method of walletd returned error: "+err+" : "+
    //  JSON.stringify(trx_args));
  });

  return retVal;
}

function checkBalanceUpdate() {
  wsapi.getBalance().then((balance)=> {
    STATE_PENDING_SAVE = false;
    //log.warn("Balance: " + parseFloat(balance.availableBalance));
    process.send({
      type: 'balanceUpdated',
      data: balance
    });
  }).catch((err) => {
    // just eat the message, there will be timeouts and that's normal
    //log.warn(`checkTransactionsUpdate: getBalance FAILED, ${err.message}`);
  });
}

let lastGetTransactionsTimestamp = 0;
function updateTransactionsList(startIndexWithMargin, requestNumBlocks) {

      // send the blocks in groups of 10,000 so that you don't
      //   overwhelm the msg buffer and slow the UI down.
      var chunk=10000;
      for (var i=0;i<requestNumBlocks;i+=chunk) {
        if (requestNumBlocks<=chunk) {
          let trx_args = {
            firstBlockIndex: startIndexWithMargin,
            blockCount: requestNumBlocks
          };

          // return values don't matter as the getTransactions Promise
          // has it's own 'thread', so we just set TX_LAST_INDEX instead
          sendTransactionsRequest(trx_args);
        } else {
          var rq = chunk;
          var chend = i+chunk;
          if (chend>(requestNumBlocks-1)) { rq = (requestNumBlocks-1)-i; }
          let trx_args = {
            firstBlockIndex: startIndexWithMargin+i,
            blockCount: rq
          };

          // return values don't matter as the getTransactions Promise
          // has it's own 'thread', so we just set TX_LAST_INDEX instead
          sendTransactionsRequest(trx_args);
        }
      }
}

function checkTransactionsUpdate(){
  if(!SERVICE_CFG || STATE_SAVING || wsapi === null ) return;

    if (! STATE_CONNECTED) {
      // walletd's network access to fedoragold_daemon is down...
      return false;
    }

    //log.warn("checkTransactionsUpdate()");

    if (LAST_BLOCK_COUNT > 1) {
      logDebug('checkTransactionsUpdate: checking tx update');
      let currentBlockCount = LAST_BLOCK_COUNT-1;
      let startIndex = (!TX_CHECK_STARTED ? 1 : TX_LAST_INDEX);
      let searchCount = currentBlockCount;

      let needCountMargin = false;
      let blockMargin = 10;
      if (TX_CHECK_STARTED) {
        searchCount = (currentBlockCount - TX_LAST_COUNT);
        needCountMargin = true;
        logDebug("we need a count margin: "+blockMargin);
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
      if (requestNumBlocks < 10000) { requestNumBlocks+=10; }

      // only save wallet if not in the middle of a resync
      // and only save if your not in the middle of a massive
      // wallet initiation downloading lots of blocks...
      let curGetTransactionsTimestamp = Math.floor(Date.now());
      if ((curGetTransactionsTimestamp - lastGetTransactionsTimestamp) > 1000) {
        lastGetTransactionsTimestamp = curGetTransactionsTimestamp;
        if (searchCountWithMargin < 100) {
          saveWallet();
        }
      }

      // will be reset if any getTransactions Promises fail
      //  which happens on a different thread...
      TX_LAST_INDEX = currentBlockCount;

      var promo = new Promise(function(resolve, reject) {
        updateTransactionsList(startIndexWithMargin, requestNumBlocks);
        resolve(true);
      }).catch(function (err) {});

      TX_CHECK_STARTED = true;
      TX_LAST_COUNT = currentBlockCount;
    }

  return true;
}

function delayReleaseSaveState(){
    setTimeout(() => {
        STATE_SAVING = false;
    }, 3000);
}

function saveWallet(){
    if(!SERVICE_CFG) return;
    if(STATE_PENDING_SAVE){
        logDebug('saveWallet: skipped, last save operation still pending');
        return false;
    }
    STATE_SAVING = true;
    //log.warn(`saveWallet: trying to save wallet`);

    var retVal = true;
    setTimeout(() => {
        wsapi.save().then(()=> {
            //log.warn(`saveWallet: OK`);
            STATE_SAVING = false;
            STATE_PENDING_SAVE = false;
            retVal = true;
        }).catch((err)=>{
            STATE_PENDING_SAVE = true;
            //just eat the message, they won't all succeed... expected behavior
            //log.warn(`saveWallet: FAILED, ${err.message}`);
            delayReleaseSaveState();
            retVal = false;
        });
    }, 10222);

    return retVal;
}

function workOnTasks(){
    taskWorker = setIntervalAsync(() => {
        if(STATE_PAUSED) return;

        // get block height of the daemon fullnode
        wsapi.getHeight().then((result) => {
            heightVal = parseInt(result.height, 10);
            let isWalletdSynching = checkBlockUpdate();
            if (isWalletdSynching)
              logDebug("walletd is synching...");
            else
              logDebug("checkBlockUpdate() reported an error...");
        }).catch((err) => {
            //just eat this... sometimes daemon takes a while to start...
            //log.warn(`getHeight from Daemon: FAILED, ${err.message}`);
        });

        checkBlockUpdate();
        checkTransactionsUpdate();
        checkBalanceUpdate();

        // no more saving wallet for no reason...
        //if(SAVE_COUNTER > 500 && isWalletdSynching){
            // This may not be useful anyway, as daemon
            // keeps track of progress on a clean exit anyways
            //saveWallet();
            //SAVE_COUNTER = 0;
        //}
        //SAVE_COUNTER++;
    }, CHECK_INTERVAL);
}

// {type: 'blah', msg: 'any'}
process.on('message', (msg) => {
    let cmd = msg || '';
    cmd.type = msg.type || 'cfg';
    cmd.data = msg.data || null;

    switch (cmd.type) {
        case 'cfg':
            if(cmd.data){
                SERVICE_CFG = cmd.data;
                initApi(SERVICE_CFG);
                process.send({
                    type: 'serviceStatus',
                    data: 'OK'
                });
            }
            if(cmd.debug){
                DEBUG = true;
                logDebug('Config received.');
                logDebug('Running in debug mode.');
            }
            break;
        case 'reset':
            reset();
            break;
        case 'start':
            //log.warn('syncWorker Starting');
            try { clearInterval(taskWorker);} catch (err) {}
            checkBlockUpdate();
            checkTransactionsUpdate();
            checkBalanceUpdate();
            setTimeout(workOnTasks, 10000);
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
            SAVE_COUNTER = 0;
            wsapi = null;
            initApi(SERVICE_CFG);
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
            logDebug('Got stop command, halting all tasks and exit...');
            TX_SKIPPED_COUNT = 0;
            SERVICE_CFG = null;
            wsapi = null;
            if(taskWorker === undefined || taskWorker === null){
                try{
                    clearInterval(taskWorker);
                    process.exit(0);
                }catch(e){
                    logDebug(`FAILED, ${e.message}`);
                }
            }
            break;
        default:
            break;
    }
});

process.on('uncaughtException', function (err) {
    logDebug(`worker uncaughtException: ${err.message}`);
    process.exit(1);
});

process.on('disconnect', () => function(){
    logDebug(`worker disconnected`);
    process.exit(1);
});
