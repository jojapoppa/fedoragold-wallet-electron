/* eslint no-empty: 0 */

const log = require('electron-log');
const WalletShellApi = require('./ws_api');
const { setIntervalAsync } = require('set-interval-async/fixed');

let DEBUG=false;
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'debug';
log.transports.file.level = 'debug';

const CHECK_INTERVAL = 500;
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
    logDebug("checkBlockUpdate() called...");

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
    //let svc = new WalletShellApi(SERVICE_CFG);

    wsapi.getStatus().then((blockStatus) => {
        STATE_PENDING_SAVE = false;
        let lastConStatus = STATE_CONNECTED;

        let kbcReturn = parseInt(blockStatus.knownBlockCount, 10);
        if (kbcReturn < 100) {

          //this shouldn't happen... connections with daemon should be solid
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
          logDebug("STATE_CONNECTED == false!");
          return false;
        } else {
          knownBlockCount = kbcReturn;
        }

        logDebug("good connection...");

        // we have good connection
        STATE_CONNECTED = true;
        let blockCount = parseInt(blockStatus.blockCount,10);

        logDebug("blockCount reported: "+blockCount);
        logDebug("knownBlockCount reported: "+knownBlockCount);

        if (LAST_HEIGHTVAL+2 >= heightVal) {
            logDebug(`checkBlockUpdate: no update`); //, skip block notifier (${TX_SKIPPED_COUNT})`);
            return false;
        }
        logDebug('checkBlockUpdate: block updated, notify block update');
        LAST_HEIGHTVAL = heightVal;
        LAST_BLOCK_COUNT = blockCount;

        if (knownBlockCount > LAST_KNOWN_BLOCK_COUNT) {
          LAST_KNOWN_BLOCK_COUNT = knownBlockCount;
        } else {
          knownBlockCount = LAST_KNOWN_BLOCK_COUNT;
        }

        // add any extras here, so renderer is not doing too many things
        let dispKnownBlockCount = (knownBlockCount-1);
        let dispBlockCount = (blockCount > dispKnownBlockCount ? dispKnownBlockCount : blockCount);
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

        checkTransactionsUpdate();
    }).catch((err) => {
        // just eat this as the connection with Daemon can be intermittent
        //log.warn(`checkBlockUpdate: FAILED, ${err.message}`);
        return false;
    });

    logDebug("returning from checkBlockUpdate");

    // isWalletdSynching
    return true;
}

function reset() {
  log.warn("syncworker detects reset()");
  TX_CHECK_STARTED = false;
  wsapi.reset({});
}

function checkTransactionsUpdate(){
    if(!SERVICE_CFG || STATE_SAVING || wsapi === null ) return;

    logDebug("checkTransactionsUpdate()");
    wsapi.getBalance().then((balance)=> {
            STATE_PENDING_SAVE = false;
            process.send({
                type: 'balanceUpdated',
                data: balance
            });

            //log.warn(balance);

            if(LAST_BLOCK_COUNT > 1){
                logDebug('checkTransactionsUpdate: checking tx update');
                let currentBlockCount = LAST_BLOCK_COUNT-1;
                let startIndex = (!TX_CHECK_STARTED ? 1 : TX_LAST_INDEX);

                // jojapoppa, would prefer if this got a smaller number on a
                //   initial reset() request... but can't figure it out...
                //   and it's not a big deal for now...
                let searchCount = currentBlockCount;

                let needCountMargin = false;
                let blockMargin = 10;
                if(TX_CHECK_STARTED){
                    searchCount = (currentBlockCount - TX_LAST_COUNT);
                    needCountMargin = true;
                    logDebug("we need a count margin: "+blockMargin);
                }

                let startIndexWithMargin = (startIndex === 1 ? 1 : (startIndex-blockMargin));
                let searchCountWithMargin = needCountMargin ?  searchCount+blockMargin : searchCount;
                let trx_args = {
                    firstBlockIndex: startIndexWithMargin,
                    blockCount: searchCountWithMargin
                };
                log.warn(`checkTransactionsUpdate: args=${JSON.stringify(trx_args)}`);
                wsapi.getTransactions( trx_args ).then((trx) => {
                    process.send({
                        type: 'transactionUpdated',
                        data: trx
                    });
                    log.warn('saveWallet()...');
                    saveWallet();
                    log.warn('done');
                    return true;
                }).catch((err)=>{
                    log.warn(`checkTransactionsUpdate: getTransactions FAILED, ${err.message}`);
                    return false;
                });
                TX_CHECK_STARTED = true;
                TX_LAST_INDEX = currentBlockCount;
                TX_LAST_COUNT = currentBlockCount;
            }
    }).catch((err)=> {
        log.warn(`checkTransactionsUpdate: getBalance FAILED, ${err.message}`);
        return false;
    });

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

    setTimeout(() => {
        wsapi.save().then(()=> {
            //log.warn(`saveWallet: OK`);
            STATE_SAVING = false;
            STATE_PENDING_SAVE = false;
            return true;
        }).catch((err)=>{
            STATE_PENDING_SAVE = true;
            //log.warn("saveWallet error...");
            log.warn(`saveWallet: FAILED, ${err.message}`);
            delayReleaseSaveState();
            return false;
        });
    }, 2222);

    return true;
}

function workOnTasks(){
    taskWorker = setIntervalAsync(() => {
        if(STATE_PAUSED) return;

        // get block height of the daemon fullnode
        wsapi.getHeight().then((result) => {
            heightVal = parseInt(result.height, 10);
            //log.warn(`new heightVal: ${heightVal}`);

            let isWalletdSynching = checkBlockUpdate();
            if (isWalletdSynching)
              logDebug("walletd is synching...");
            else
              logDebug("checkBlockUpdate() reported an error...");
        }).catch((err) => {
            //just eat this... sometimes daemon takes a while to start...
            //log.warn(`getHeight from Daemon: FAILED, ${err.message}`);
        });

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
            log.warn('Starting');
            try { clearInterval(taskWorker);} catch (err) {}
            checkBlockUpdate();
            //checkTransactionsUpdate();
            setTimeout(workOnTasks, 5000);
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
