/* eslint no-empty: 0 */

/* globals iqwerty */
const {webFrame, remote} = require('electron');
const Store = require('electron-store');
const log = require('electron-log');
const wsutil = require('./ws_utils');
const WalletShellSession = require('./ws_session');
const config = require('./ws_config');

const brwin = remote.getCurrentWindow();
const settings = new Store({name: 'Settings'});
const wsession = new WalletShellSession();

/* sync progress ui */
const syncDiv = document.getElementById('navbar-div-sync');
const syncInfoBar = document.getElementById('navbar-text-sync');
const connInfoDiv = document.getElementById('conn-info');

const SYNC_STATUS_NET_CONNECTED = -10;
const SYNC_STATUS_NET_DISCONNECTED = -50;
const SYNC_STATUS_IDLE = -100;
const SYNC_STATUS_NODE_ERROR = -200;
const SYNC_STATUS_RESCAN = -300;

const WFCLEAR_INTERVAL = 5;
let WFCLEAR_TICK = 0;

function setWinTitle(title){
    let defaultTitle = wsession.get('defaultTitle');
    let newTitle = defaultTitle;
    if(title){
        newTitle = `${defaultTitle} ${title}`;
    }
    brwin.setTitle(newTitle);

    // reinitialize the top block number...
    // means it will be 0 until a RESCAN has completed
    // won't assess the stored 'current_block' until
    // the daemon is minimally ready
    settings.set('top_block', 0);
    settings.set('current_block', 0);
}

function triggerTxRefresh(){
    //log.warn('in triggerTxRefresh()');
    const txUpdateInputFlag = document.getElementById('transaction-updated');
    txUpdateInputFlag.value = 1;
    txUpdateInputFlag.dispatchEvent(new Event('change'));
}

function updateSyncProgress(data){
    const iconSync = document.getElementById('navbar-icon-sync');
    let blockCount = data.displayBlockCount+1;
    let daemonHeight = data.displayDaemonHeight;
    let knownBlockCount = data.displayKnownBlockCount+1;
    let blockSyncPercent = data.syncPercent;
    let uiMessage = data.uiMessage;
    let statusText = '';
    let syMsg = '';

    // Sanity check on spurious values at start/restart of syncs
    if (knownBlockCount < 0 || daemonHeight < 0 || blockCount < 0) {
        knownBlockCount = 0;
        daemonHeight = 0;
        blockCount = 0;
        blockSyncPercent = 0;
    }

    // this tells you if the local daemon is truly ready yet...
    if (uiMessage.search("Block:") === 1) {
       var blocknumber = uiMessage.substring(7);
       var numm = parseInt(blocknumber, 10);  
       settings.set('current_block', numm);
       //log.warn("current_block set in settings to: "+numm);
    }
    if (knownBlockCount > 100) {
        // don't allow unnecessary disk writes
        var tblk = settings.get('top_block');
        if (knownBlockCount > tblk) {
          settings.set('top_block', knownBlockCount);
          //log.warn("top_block set in settings to: "+knownBlockCount);
        }
    }

    if (data.knownBlockCount === SYNC_STATUS_RESCAN) {

        // only show SCAN messages if wallet isn't opened yet
        if ((wsession.get('serviceReady') || false)) {
          return;
        }

        statusText = '' + uiMessage;

        // sync info bar class
        syncDiv.className = '';
        //iconSync.setAttribute('data-icon', 'pause-circle');
        iconSync.setAttribute('data-icon', 'check');
        syncInfoBar.textContent = statusText;

    } else if(data.knownBlockCount === SYNC_STATUS_NET_CONNECTED){
        // sync status text
        statusText = 'RESUMING WALLET SYNC...';
        syncInfoBar.innerHTML = statusText;
        // sync info bar class
        syncDiv.className = 'syncing';
        // sync status icon
        iconSync.setAttribute('data-icon', 'sync');
        iconSync.classList.remove('slow-spin');
        iconSync.classList.add('slow-spin');
        // connection status
        connInfoDiv.innerHTML = 'Connection restored, resuming sync process...';
        connInfoDiv.classList.remove('empty');
        connInfoDiv.classList.remove('conn-warning');

        // sync sess flags
        wsession.set('syncStarted', false);
        wsession.set('synchronized', false);
        brwin.setProgressBar(-1);
    }else if(data.knownBlockCount === SYNC_STATUS_NET_DISCONNECTED){
        // sync status text
        statusText = 'PAUSED, CONNECTING TO NETWORK';
        syncInfoBar.innerHTML = statusText;
        // sync info bar class
        syncDiv.className = '';
        // sync status icon
        iconSync.setAttribute('data-icon', 'ban');
        iconSync.classList.remove('slow-spin');
        // connection status
        connInfoDiv.innerHTML = 'Paused, will continue once blockchain connection is reestablished';
        connInfoDiv.classList.remove('empty');
        connInfoDiv.classList.remove('conn-warning');
        connInfoDiv.classList.add('conn-warning');

        // sync sess flags
        wsession.set('syncStarted', false);
        wsession.set('synchronized', false);
        brwin.setProgressBar(-1);
    }else if(data.knownBlockCount === SYNC_STATUS_IDLE){

        // sync status text
        statusText = 'IDLE';
        syncInfoBar.innerHTML = statusText;
        // sync info bar class
        syncDiv.className = '';
        // sync status icon
        iconSync.setAttribute('data-icon', 'pause-circle');
        iconSync.classList.remove('slow-spin');
        // connection status
        connInfoDiv.classList.remove('conn-warning');
        connInfoDiv.classList.remove('empty');
        connInfoDiv.classList.add('empty');
        connInfoDiv.textContent = '';

        // sync sess flags
        wsession.set('syncStarted', false);
        wsession.set('synchronized', false);
        brwin.setProgressBar(-1);
        // reset wintitle
        setWinTitle();
        // no node connected
        wsession.set('connectedNode', '');
    }else if(data.knownBlockCount === SYNC_STATUS_NODE_ERROR){
        // not connected
        // status info bar class
        syncDiv.className = 'failed';
        // sync status text
        statusText = 'NODE ERROR';
        syncInfoBar.textContent = statusText;
        //sync status icon
        iconSync.setAttribute('data-icon', 'times');
        iconSync.classList.remove('slow-spin');
        // connection status
        connInfoDiv.innerHTML = 'Connection failed, try switching to another Node in settings page, close and reopen your wallet';
        connInfoDiv.classList.remove('empty');
        connInfoDiv.classList.remove('conn-warning');
        connInfoDiv.classList.add('conn-warning');
        wsession.set('connectedNode', '');
        brwin.setProgressBar(-1);
    }else{
        // sync sess flags
        wsession.set('syncStarted', true);
        statusText = `${blockCount}/${knownBlockCount}` ;

            // note: don't call setProgressBar, or it really kills performance

            syMsg = "SYNCING ";
            if (blockCount+3 >= knownBlockCount) {
              syMsg = "SYNCED "
              syncDiv.className = 'synced';
              iconSync.setAttribute('data-icon', 'check');
              iconSync.classList.remove('slow-spin');
              // sync status sess flag
              wsession.set('synchronized', true);
            } else {
              syncDiv.className = 'syncing';
              iconSync.setAttribute('data-icon', 'sync');
              iconSync.classList.remove('slow_spin');
              iconSync.classList.add('slow-spin');
              // sync status sess flag
              wsession.set('synchronized', false);
            }

            // status text
            let percent = ((blockCount / knownBlockCount)*100).toFixed(2);
            statusText = `${syMsg} ${statusText} (${percent}%)`;
            syncInfoBar.textContent = statusText;
            let taskbarProgress = +(parseFloat(percent)/100).toFixed(2);
            if (blockSyncPercent === 0) {
              syncDiv.className = '';
              connInfoDiv.classList.remove('conn-warning');
              connInfoDiv.classList.remove('empty');
              connInfoDiv.classList.add('empty');
              iconSync.classList.remove('slow-spin');
              iconSync.setAttribute('data-icon', 'pause-circle');
              syncInfoBar.textContent = 'STARTING SYNC...';
            } else {
              brwin.setProgressBar(taskbarProgress);
            }

        let connStatusText = ' '; //`Connected to: <strong>${wsession.get('connectedNode')}</strong>`;
        let connNodeFee = wsession.get('nodeFee');
        if(connNodeFee > 0 ){
            connStatusText += ` | Node fee: <strong>${connNodeFee.toFixed(config.decimalPlaces)} ${config.assetTicker}</strong>`;
        }
        connInfoDiv.innerHTML = connStatusText;
        connInfoDiv.classList.remove('conn-warning');
        connInfoDiv.classList.remove('empty');
    }

    if(WFCLEAR_TICK === 0 || WFCLEAR_TICK === WFCLEAR_INTERVAL){
        webFrame.clearCache();
        WFCLEAR_TICK = 0;
    }
    WFCLEAR_TICK++;
}

function updateBalance(data){
    const balanceAvailableField = document.querySelector('#balance-available > span');
    const balanceLockedField = document.querySelector('#balance-locked > span');
    const maxSendFormHelp = document.getElementById('sendFormHelp');
    const sendMaxAmount = document.getElementById('sendMaxAmount');
    let inputSendAmountField = document.getElementById('input-send-amount');

    if(!data) return;
    let availableBalance = parseFloat(data.availableBalance) || 0;
    if(availableBalance <= 0){
        inputSendAmountField.value = 0;
        inputSendAmountField.setAttribute('max','0.00');
        inputSendAmountField.setAttribute('disabled','disabled');
        maxSendFormHelp.innerHTML = "You don't have any funds to be sent.";
        sendMaxAmount.dataset.maxsend = 0;
        sendMaxAmount.classList.remove('hidden');
        sendMaxAmount.classList.add('hidden');
        wsession.set('walletUnlockedBalance', 0);
        wsession.set('walletLockedBalance', 0);
        if(availableBalance < 0) return;
    }

    //let bUnlocked = (availableBalance / 100000000).toFixed(8);
    let bUnlocked = wsutil.amountForMortal(availableBalance);
    let bLocked = wsutil.amountForMortal(data.lockedAmount);
    balanceAvailableField.innerHTML = bUnlocked;
    balanceLockedField.innerHTML = bLocked;
    wsession.set('walletUnlockedBalance', bUnlocked);
    wsession.set('walletLockedBalance', bLocked);
    let walletFile = require('path').basename(settings.get('recentWallet'));
    let wintitle = `(${walletFile}) - ${bUnlocked} ${config.assetTicker}`;
    setWinTitle(wintitle);

    if(availableBalance > 0){
        let fees = (wsession.get('nodeFee')+config.minimumFee);
        let maxSend = (bUnlocked - fees).toFixed(config.decimalPlaces);
        inputSendAmountField.setAttribute('max',maxSend);
        inputSendAmountField.removeAttribute('disabled');
        maxSendFormHelp.innerHTML = `Max. amount is ${maxSend}`;
        sendMaxAmount.dataset.maxsend = maxSend;
        sendMaxAmount.classList.remove('hidden');
    }
}

function updateTransactions(blockItems){

    //log.warn("updateTransactions result items received: "+blockItems.length);
    let txlistExisting = wsession.get('txList');

    if(!txlistExisting.length && !blockItems.length){
        document.getElementById('transaction-export').classList.remove('hidden');
        document.getElementById('transaction-export').classList.add('hidden');
        document.getElementById('transaction-reset').classList.remove('hidden');
        document.getElementById('transaction-reset').classList.add('hidden');
    }else{
        document.getElementById('transaction-export').classList.remove('hidden');
        document.getElementById('transaction-reset').classList.remove('hidden');
   }

    if(!blockItems.length) return;
    let txListNew = [];

    Array.from(blockItems).forEach((block) => {
        block.transactions.map((tx) => {
            if(tx.amount !== 0 && !wsutil.objInArray(txlistExisting, tx, 'transactionHash')){
                tx.amount = wsutil.amountForMortal(tx.amount);
                tx.timeStr = new Date(tx.timestamp*1000).toUTCString();
                tx.fee = wsutil.amountForMortal(tx.fee);
                tx.paymentId = tx.paymentId.length ? tx.paymentId : '-';
                tx.txType = (tx.amount > 0 ? 'in' : 'out');
                tx.rawAmount = tx.amount;
                tx.rawFee = tx.fee;
                tx.rawPaymentId = tx.paymentId;
                tx.rawHash = tx.transactionHash;
                txListNew.unshift(tx);
            }
        });
    });

    //log.warn("primary processing of transaction block completed");

    if(!txListNew.length) return;

    let latestTx = txListNew[0];
    let newLastHash = latestTx.transactionHash;
    let newLastTimestamp = latestTx.timestamp;
    let newTxAmount = latestTx.amount;

    // store it
    wsession.set('txLastHash',newLastHash);
    wsession.set('txLastTimestamp', newLastTimestamp);
    let txList = txListNew.concat(txlistExisting);
    wsession.set('txList', txList);
    wsession.set('txLen', txList.length);
    wsession.set('txNew', txListNew);
    wsession.set('txLenNew', txListNew.length);

    //log.warn('txLen: ', txList.length);
    //log.warn('txLenNew: ', txListNew.length);

    let currentDate = new Date();
    currentDate = `${currentDate.getUTCFullYear()}-${currentDate.getUTCMonth()+1}-${currentDate.getUTCDate()}`;
    let lastTxDate = new Date(newLastTimestamp*1000);
    lastTxDate = `${lastTxDate.getUTCFullYear()}-${lastTxDate.getUTCMonth()+1}-${lastTxDate.getUTCDate()}`;

    // handle refresh asynchronously...
    setTimeout(triggerTxRefresh, 1000);

    // setup for desktop notifications (to OS desktop)
    let rememberedLastHash = settings.get('last_notification', '');
    let notify = true;

    // test for invalid desktop notifications
    if(lastTxDate !== currentDate || (newTxAmount < 0) || rememberedLastHash === newLastHash ){
        notify = false;
    }

    // desktop notification
    if(notify){

        settings.set('last_notification', newLastHash);
        let notiOptions = {
            'body': `Amount: ${(newTxAmount)} ${config.assetTicker}\nHash: ${newLastHash.substring(24,-0)}...`,
            'icon': '../assets/walletshell_icon.png'
        };

        let itNotification = new Notification('Incoming Transfer', notiOptions);

        itNotification.onclick = (event) => {
            event.preventDefault();
            let  txNotifyFiled = document.getElementById('transaction-notify');
            txNotifyFiled.value = 1;
            txNotifyFiled.dispatchEvent(new Event('change'));
            if(!brwin.isVisible()) brwin.show();
            if(brwin.isMinimized()) brwin.restore();
            if(!brwin.isFocused()) brwin.focus();
        };
    }
}

function showFeeWarning(fee){
    fee = fee || 0; // fee vale already for mortal
    let nodeFee = parseFloat(fee);
    if(nodeFee <= 0) return;

    let dialog = document.getElementById('main-dialog');
    if(dialog.hasAttribute('open')) return;

    dialog.classList.remove('dialog-warning');
    dialog.classList.add('dialog-warning');
    let htmlStr = `
        <h5>Fee Info</h5>
        <p>You are connected to a public node (${settings.get('daemon_host')}:${settings.get('daemon_port')}) that charges a fee to send transactions.<p>
        <p>The fee for sending transactions is: <strong>${fee.toFixed(config.decimalPlaces)} ${config.assetTicker} </strong>.<br>
            If you don't want to pay the node fee, please close your wallet, reopen and choose different public node (or run your own node).
        </p>
        <p style="text-align:center;margin-top: 1.25rem;"><button  type="button" class="form-bt button-green" id="dialog-end">OK, I Understand</button></p>
    `;

    wsutil.innerHTML(dialog, htmlStr);
    let dialogEnd = document.getElementById('dialog-end');
    dialogEnd.addEventListener('click', () => {
        try{
            dialog.classList.remove('dialog-warning');
            document.getElementById('main-dialog').close();
        }catch(e){}
    });
    dialog = document.getElementById('main-dialog');
    dialog.showModal();
    dialog.addEventListener('close', function(){
        wsutil.clearChild(dialog);
    });
}

function updateQr(address){
    if(!address){
        triggerTxRefresh();
        return;
    }

    let walletHash = wsutil.b2sSum(address);
    wsession.set('walletHash', walletHash);

    let oldImg = document.getElementById('qr-gen-img');
    if(oldImg) oldImg.remove();

    let qr_base64 = wsutil.genQrDataUrl(address);
    if(qr_base64.length){
        let qrBox = document.getElementById('div-w-qr');
        let qrImg = document.createElement("img");
        qrImg.setAttribute('id', 'qr-gen-img');
        qrImg.setAttribute('src', qr_base64);
        qrBox.prepend(qrImg);
        document.getElementById('scan-qr-help').classList.remove('hidden');
    }else{
        document.getElementById('scan-qr-help').classList.remove('hidden');
        document.getElementById('scan-qr-help').classList.add('hidden');
    }
}

function resetFormState(){
    const allFormInputs = document.querySelectorAll('.section input,.section textarea');
    if(!allFormInputs) return;

    for(var i=0;i<allFormInputs.length;i++){
        let el = allFormInputs[i];
        if(el.dataset.initial){
            if(!el.dataset.noclear){
                el.value = settings.has(el.dataset.initial) ? settings.get(el.dataset.initial) : '';
                if(el.getAttribute('type') === 'checkbox'){
                    el.checked = settings.get(el.dataset.initial);
                }
            }
        }else{
            if(!el.dataset.noclear) el.value = '';
        }
    }

    const settingsBackBtn = document.getElementById('button-settings-back');
    if(wsession.get('serviceReady')){
        connInfoDiv.classList.remove('empty');
        settingsBackBtn.dataset.section = 'section-welcome';
    }else{
        connInfoDiv.classList.remove('empty');
        connInfoDiv.classList.add('empty');
        settingsBackBtn.dataset.section = 'section-overview';
    }
}

// update ui state, push from svc_main
function updateUiState(msg){

    //log.warn('in updateUiState: ', msg.type);

    // do something with msg
    let notif = '';
    switch (msg.type) {
        case 'blockUpdated':
            updateSyncProgress(msg.data);
            break;
        case 'balanceUpdated':
            updateBalance(msg.data);
            break;
        case 'rescan':
            updateSyncProgress(msg.data);
            break;
        case 'transactionStatus':
            var transactionsInfoBar = document.getElementById('navbar-text-transactions');
            transactionsInfoBar.innerHTML = "-Recieved block of transactions: "+msg.data;
            break;
        case 'transactionUpdated':
            updateTransactions(msg.data);
            break;
        case 'nodeFeeUpdated':
            showFeeWarning(msg.data);
            break;
        case 'addressUpdated':
            updateQr(msg.data);
            break;
        case 'sectionChanged':
            if(msg.data) resetFormState(msg.data);
            break;
        case 'fusionTxCompleted':
            notif = 'Optimization completed';
            if(msg.data) notif = msg.data;

            iqwerty.toast.Toast(notif, {
                style: { main: {
                    'padding': '4px 6px','left': '3px','right':'auto','border-radius': '0px'
                }},
                settings: {duration: 5000}
            });
            break;
        default:
            log.warn('invalid command received by ui', msg.type);
            break;
    }
}

module.exports = {updateUiState};
