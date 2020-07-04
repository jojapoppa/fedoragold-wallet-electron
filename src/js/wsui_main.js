/* eslint no-empty: 0 */
/*jshint bitwise: false*/
/* globals iqwerty */
/* globals List */

const os = require('os');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const crypto = require("crypto");

const {dialog, clipboard, remote, ipcRenderer, shell} = require('electron');
const Store = require('electron-store');
const Mousetrap = require('./extras/mousetrap.min.js');
const autoComplete = require('./extras/auto-complete');
const wsutil = require('./ws_utils');
const WalletShellSession = require('./ws_session');
const WalletShellManager = require('./ws_manager');
const config = require('./ws_config');
const AnsiUp = require('ansi_up');
const wsmanager = new WalletShellManager();
const wsession = new WalletShellSession();
const settings = new Store({ name: 'Settings' });
const abook = new Store({
    name: 'AddressBook',
    encryptionKey: config.addressBookObfuscateEntries ? config.addressBookObfuscationKey : null
});

const win = remote.getCurrentWindow();
const Menu = remote.Menu;

const WS_VERSION = settings.get('version', 'unknown');
const DEFAULT_WALLET_PATH = remote.app.getPath('home');

var last8_rigID = "";

let WALLET_OPEN_IN_PROGRESS = false;
let FUSION_IN_PROGRESS = false;
let TXLIST_OBJ = null;
let COMPLETION_PUBNODES;
let COMPLETION_ADDRBOOK;

/*  dom elements vars; */
// main section link
let sectionButtons;
// generics
let genericBrowseButton;
let genericFormMessage;
let genericEnterableInputs;
let genericEditableInputs;
let firstTab;
let isRescan = false;

// settings page
let settingsInputDaemonAddress;
let settingsInputDaemonPort;
let settingsInputWalletdPort;
let settingsInputServiceBin;
let settingsInputMinToTray;
let settingsInputCloseToTray;
let settingsButtonSave;
let settingsDaemonHostFormHelp;
let settingsDaemonPortFormHelp;
let settingsWalletdPortFormHelp;
let settingsCjdnsAdminPort;
let settingsCjdnsUDPPort;
let settingsCjdnsBeaconPort;

// mining page
let miningStartStop;
let miningPort;
let miningConsole;
// overview page
let overviewWalletAddress;
let overviewWalletCloseButton;
let overviewPaymentIdGen;
let overviewIntegratedAddressGen;
// addressbook page
let addressBookInputName;
let addressBookInputWallet;
let addressBookInputPaymentId;
let addressBookInputUpdate;
let addressBookButtonSave;
let addressBookButtonBack;
// open wallet page
let walletOpenInputPath;
let walletOpenInputPassword;
let walletOpenButtonOpen;
let walletOpenButtons;
// show/export keys page
let overviewShowKeyButton;
let showkeyButtonExportKey;
let showkeyInputViewKey;
let showkeyInputSpendKey;
//let showkeyInputSeed;
// send page
let sendInputAddress;
let sendInputAmount;
let sendInputPaymentId;
let sendInputFee;
let sendButtonSend;
let sendMaxAmount;
let sendOptimize;
// create wallet
let overviewButtonCreate;
let walletCreateInputPath;
// let walletCreateInputFilename;
let walletCreateInputPassword;
// import wallet keys
let importKeyButtonImport;
let importKeyInputPath;
// let importKeyInputFilename;
let importKeyInputPassword;
let importKeyInputViewKey;
let importKeyInputSpendKey;
//let importKeyInputScanHeight;
// import wallet seed
let importSeedButtonImport;
let importSeedInputPath;
//let importSeedInputFilename;
let importSeedInputPassword;
let importSeedInputMnemonic;
let importSeedInputScanHeight;
// transaction
//let txButtonRefresh;
let txButtonSortAmount;
let txButtonSortDate;
let txInputUpdated;
let txInputNotify;
let txButtonExport;
let txButtonReset;
let txButtonExplorer;
// misc
let thtml;
//let dmswitch;
let kswitch;

function populateElementVars(){

    // misc
    thtml = document.documentElement;
    //dmswitch = document.getElementById('tswitch');
    kswitch = document.getElementById('kswitch');
    firstTab = document.querySelector('.navbar-button');
    // generics
    genericBrowseButton = document.querySelectorAll('.path-input-button');
    genericFormMessage = document.getElementsByClassName('form-ew');
    genericEnterableInputs = document.querySelectorAll('.section input:not(.noenter)');
    genericEditableInputs = document.querySelectorAll('textarea:not([readonly]), input:not([readonly]');

    // main section link
    sectionButtons = document.querySelectorAll('[data-section]');

    // settings input & elements
    settingsInputDaemonAddress = document.getElementById('input-settings-daemon-address');
    settingsInputDaemonPort = document.getElementById('input-settings-daemon-port');
    settingsInputWalletdPort = document.getElementById('input-settings-walletd-port');
    settingsInputServiceBin = document.getElementById('input-settings-path');
    //settingsInputMinToTray = document.getElementById('checkbox-tray-minimize');
    //settingsInputCloseToTray = document.getElementById('checkbox-tray-close');
    settingsButtonSave = document.getElementById('button-settings-save');
    settingsDaemonHostFormHelp = document.getElementById('daemonHostFormHelp');
    settingsDaemonPortFormHelp = document.getElementById('daemonPortFormHelp');
    settingsWalletdPortFormHelp = document.getElementById('walletdPortFormHelp');
    settingsCjdnsAdminPort = document.getElementById('input-settings-cjdnsadmin-port');
    settingsCjdnsUDPPort = document.getElementById('input-settings-cjdnsudp-port');
    settingsCjdnsBeaconPort = document.getElementById('input-settings-cjdnsudp-port');

    // mining page
    miningStartStop = document.getElementById('checkbox-tray-mining');
    miningPort = document.getElementById('input-miner-walletd-port');
    miningConsole = document.getElementById('miningterminal');

    // overview pages
    overviewWalletAddress = document.getElementById('wallet-address');
    overviewWalletCloseButton = document.getElementById('button-overview-closewallet');
    overviewPaymentIdGen = document.getElementById('payment-id-gen');
    overviewIntegratedAddressGen = document.getElementById('integrated-wallet-gen');

    // addressbook page
    addressBookInputName = document.getElementById('input-addressbook-name');
    addressBookInputWallet = document.getElementById('input-addressbook-wallet');
    addressBookInputPaymentId = document.getElementById('input-addressbook-paymentid');
    addressBookInputUpdate = document.getElementById('input-addressbook-update');
    addressBookButtonSave = document.getElementById('button-addressbook-save');
    addressBookButtonBack = document.getElementById('button-addressbook-back');

    // open wallet page
    walletOpenInputPath = document.getElementById('input-load-path');
    walletOpenInputPassword = document.getElementById('input-load-password');
    walletOpenButtonOpen = document.getElementById('button-load-load');
    walletOpenButtons = document.getElementById('walletOpenButtons');

    // show/export keys page
    overviewShowKeyButton = document.getElementById('button-show-reveal');
    showkeyButtonExportKey = document.getElementById('button-show-export');
    showkeyInputViewKey = document.getElementById('key-show-view');
    showkeyInputSpendKey = document.getElementById('key-show-spend');
    //showkeyInputSeed = document.getElementById('seed-show');

    // send page
    sendInputAddress = document.getElementById('input-send-address');
    sendInputAmount = document.getElementById('input-send-amount');
    sendInputPaymentId = document.getElementById('input-send-payid');
    sendInputFee = document.getElementById('input-send-fee');
    sendButtonSend = document.getElementById('button-send-send');
    // maxSendFormHelp = document.getElementById('sendFormHelp');
    sendMaxAmount = document.getElementById('sendMaxAmount');
    sendOptimize = document.getElementById('button-send-optimize');
    // create wallet
    overviewButtonCreate = document.getElementById('button-create-create');
    walletCreateInputPath = document.getElementById('input-create-path');
    //walletCreateInputFilename = document.getElementById('input-create-name');
    walletCreateInputPassword = document.getElementById('input-create-password');
    // import wallet keys
    importKeyButtonImport = document.getElementById('button-import-import');
    importKeyInputPath = document.getElementById('input-import-path');
    //importKeyInputFilename = document.getElementById('input-import-name');
    importKeyInputPassword = document.getElementById('input-import-password');
    importKeyInputViewKey = document.getElementById('key-import-view');
    importKeyInputSpendKey = document.getElementById('key-import-spend');
    //importKeyInputScanHeight = document.getElementById('key-import-height');
    // import wallet seed
    importSeedButtonImport = document.getElementById('button-import-seed-import');
    importSeedInputPath = document.getElementById('input-import-seed-path');
    //importSeedInputFilename = document.getElementById('input-import-seed-name');
    importSeedInputPassword = document.getElementById('input-import-seed-password');
    importSeedInputMnemonic = document.getElementById('key-import-seed');
    importSeedInputScanHeight = document.getElementById('key-import-seed-height');
    // tx page
    // transaction
    //txButtonRefresh = document.getElementById('button-transactions-refresh');
    txButtonSortAmount = document.getElementById('txSortAmount');
    txButtonSortDate = document.getElementById('txSortTime');
    txInputUpdated = document.getElementById('transaction-updated');
    txInputNotify = document.getElementById('transaction-notify');
    txButtonExport = document.getElementById('transaction-export');
    txButtonReset = document.getElementById('transaction-reset');
}

// crude/junk template :)
let jtfr = {
   tFind:  [
        "WalletShell",
	"https://github.com/jojapoppa/fedoragold-wallet-electron", 
        "FedoraGold",
        "FED",
        "fedoragold_walletd"
    ],
    tReplace: [
        config.appName,
        config.appGitRepo,
        config.assetName,
        config.assetTicker,
        config.walletServiceBinaryFilename
    ]
};

let junkTemplate = (text) => {
    return jtfr.tFind.reduce((acc, item, i) => {
        const regex = new RegExp(item, "g");
        return acc.replace(regex, jtfr.tReplace[i]);
  }, text);
};

function initSectionTemplates(){
    const importLinks = document.querySelectorAll('link[rel="import"]');
    for (var i = 0; i < importLinks.length; i++){
        let template = importLinks[i].import.getElementsByTagName("template")[0];
        let templateString = junkTemplate(template.innerHTML);
        let templateNode = document.createRange().createContextualFragment(templateString);
        //let clone = document.importNode(templateNode, true);
        let clone = document.adoptNode(templateNode);
        //let clone = document.importNode(template.content, true);
        document.getElementById('main-div').appendChild(clone);
    }
    // once all elements in place, safe to populate dom vars
    populateElementVars();
}

// utility: show toast message
function showToast(msg, duration, force){
    duration = duration || 1800;
    force = force || false;
    let datoaste = document.getElementById('datoaste');
    if(datoaste && force) {
        datoaste.parentNode.removeChild(datoaste);
    }
    
    //if(datoaste) return;

    let toastOpts = {
        style: { main: { 
            'padding': '4px 6px','left': '3px','right':'auto','border-radius': '0px'
        }},
        settings: {duration: duration}
    };

    let openedDialog = document.querySelector('dialog[open]');
    if(openedDialog){
        openedDialog.classList.add('dialog-alerted');
        setTimeout(()=>{
            openedDialog.classList.remove('dialog-alerted');
        },duration+100);
    }
    iqwerty.toast.Toast(msg, toastOpts);
}

// utility: dark mode
function setDarkMode(dark){

    // jojapoppa, deactivated until common.css can be edited for daytime mode
    dark = true;

    let tmode = dark ? 'dark' : '';
    if(tmode === 'dark'){
        thtml.classList.add('dark');
//        dmswitch.setAttribute('title', 'Leave dark mode');
//        dmswitch.firstChild.classList.remove('fa-moon');
//        dmswitch.firstChild.classList.add('fa-sun');
        settings.set('darkmode',true);
//        dmswitch.firstChild.dataset.icon = 'sun';
    } //else{
//        thtml.classList.remove('dark');
//        dmswitch.setAttribute('title', 'Swith to dark mode');
//        dmswitch.firstChild.classList.remove('fa-sun');
//        dmswitch.firstChild.classList.add('fa-moon');
//        settings.set('darkmode', false);
//        dmswitch.firstChild.dataset.icon = 'moon';
//    }
}

let keybindingTpl = `<div class="transaction-panel">
<h4>Available Keybindings:</h4>
<table class="custom-table kb-table">
<tbody>
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>Home</kbd></th>
    <td>Switch to <strong>overview/welcome</strong> screen</td>
</tr> 
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>h</kbd></th>
    <td>Switch to <strong>overview/welcome</strong> screen</td>
</tr>
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>Tab</kbd></th>
    <td>Switch to <strong>next screen</strong></td>
</tr>
<tr>
<th scope="col"><kbd>Ctrl</kbd>+<kbd>n</kbd></th>
<td>Switch to <strong>Create new wallet</strong> screen</td></tr>
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>o</kbd></th>
    <td>Switch to <strong>Open a wallet</strong> screen</td>
</tr>
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>i</kbd></th>
    <td>Switch to <strong>Import wallet from private keys</strong> screen</td>
</tr>
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>e</kbd></th>
    <td>Switch to <strong>Export private keys</strong> screen (when wallet opened)</td>
</tr> 
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>t</kbd></th>
    <td>Switch to <strong>Transactions</strong> screen (when wallet opened)</td>
</tr> 
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>s</kbd></th>
    <td>Switch to <strong>Send/Transfer</strong> screen (when wallet opened)</td>
</tr> 
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>x</kbd></th>
    <td>Close wallet</td>
</tr> 
<tr>
    <th scope="col"><kbd>Ctrl</kbd>+<kbd>/</kbd></th>
    <td>Display shortcut key information (this dialog)</td>
</tr>
<tr>
    <th scope="col"><kbd>Esc</kbd></th>
    <td>Close any opened dialog (like this dialog)</td>
</tr> 
</tbody>
</table>
<div class="div-panel-buttons">
    <button  data-target="#ab-dialog" type="button" class="button-gray dialog-close-default">Close</button>
</div>
</div>
`;

//<tr>
//    <th scope="col"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>i</kbd></th>
//    <td>Switch to <strong>Import wallet from mnemonic seed</strong> screen</td>
//</tr>
//<tr>
//    <th scope="col"><kbd>Ctrl</kbd>+<kbd>\\</kbd></th>
//    <td>Toggle dark/night mode</td>
//</tr>

function genPaymentId(ret){
    ret = ret || false;
    
    let payId = require('crypto').randomBytes(32).toString('hex');
    if(ret) return payId;
    
    let dialogTpl = `<div class="transaction-panel">
    <h4>Generated Payment ID:</h4>
    <textarea data-cplabel="Payment ID" title="click to copy" class="ctcl default-textarea" rows="1" readonly="readonly">${payId}</textarea>
    <div class="div-panel-buttons">
        <button  data-target="#ab-dialog" type="button" class="button-gray dialog-close-default">Close</button>
    </div>
    `;
    let dialog = document.getElementById('ab-dialog');
    if(dialog.hasAttribute('open')) dialog.close();
    dialog.innerHTML = dialogTpl;
    dialog.showModal();
}

function showIntegratedAddressForm(){
    let dialog = document.getElementById('ab-dialog');
    let ownAddress = wsession.get('loadedWalletAddress');
    if(dialog.hasAttribute('open')) dialog.close();

    let iaform = `<div class="transaction-panel">
    <h4>Generate Integrated Address:</h4>
    <div class="input-wrap">
    <label>Wallet Address</label>
    <textarea id="genInputAddress" class="default-textarea" placeholder="Required, put any valid ${config.assetTicker} address..">${ownAddress}</textarea>
    </div>
    <div class="input-wrap">
    <label>Payment Id (<a id="makePaymentId" class="wallet-tool inline-tool" title="generate random payment id...">generate</a>)</label>
    <input id="genInputPaymentId" type="text" required="required" class="text-block" placeholder="Required, enter a valid payment ID, or click generate to get random ID" />
    </div>
    <div class="input-wrap">
    <textarea data-cplabel="Integrated address" placeholder="Fill the form &amp; click generate, integrated address will appear here..." rows="3" id="genOutputIntegratedAddress" class="default-textarea ctcl" readonly="readonly"></textarea>
    </div>
    <div class="input-wrap">
        <span class="form-ew form-msg text-spaced-error hidden" id="text-gia-error"></span>
    </div>
    <div class="div-panel-buttons">
        <button id="doGenIntegratedAddr" type="button" class="button-green dialog-close-default">Generate</button>
        <button  data-target="#ab-dialog" type="button" class="button-gray dialog-close-default">Close</button>
    </div>
    `;
    dialog.innerHTML = iaform;
    dialog.showModal();
}

function showKeyBindings(){
    let dialog = document.getElementById('ab-dialog');
    if(dialog.hasAttribute('open')) dialog.close();
    dialog.innerHTML = keybindingTpl;
    dialog.showModal();
}

function switchTab(){
    if(WALLET_OPEN_IN_PROGRESS){
        showToast('Opening wallet in progress, please wait...');
        return;
    }
    let isServiceReady = wsession.get('serviceReady') || false;
    let activeTab = document.querySelector('.btn-active');
    let nextTab = activeTab.nextElementSibling || firstTab;
    let nextSection = nextTab.dataset.section.trim();
    let skippedSections = [];
    if(!isServiceReady){
        skippedSections = ['section-send', 'section-transactions'];
        if(nextSection === 'section-overview') nextSection = 'section-welcome';
    }

    while(skippedSections.indexOf(nextSection) >=0){
        nextTab = nextTab.nextElementSibling;
        nextSection = nextTab.dataset.section.trim();
    }
    changeSection(nextSection);
}

// section switcher
function changeSection(sectionId, isSettingRedir) {
    if(WALLET_OPEN_IN_PROGRESS){
        showToast('Opening wallet in progress, please wait...');
        return;
    }
    
    formMessageReset();
    isSettingRedir = isSettingRedir === true ? true : false;
    let targetSection = sectionId.trim();
    let untoast = false;
    if(targetSection === 'section-welcome'){
        targetSection = 'section-overview';
        untoast = true;
    }

    let isServiceReady = wsession.get('serviceReady') || false;
    let needServiceReady = ['section-transactions', 'section-send', 'section-overview'];
    let needServiceStopped = 'section-welcome';
    let needSynced = ['section-send'];
    if(needSynced.indexOf(targetSection) && FUSION_IN_PROGRESS){
        showToast('Wallet optimization in progress, please wait');
        return;
    }

    let finalTarget = targetSection;
    let toastMsg = '';
   
    let isSynched = wsession.get('synchronized', false);
    if (isRescan) {
      isSynched = false;
    }
 
    if(needServiceReady.indexOf(targetSection) >=0 && !isServiceReady){
        // no access to wallet, send, tx when no wallet opened
        finalTarget = 'section-welcome';
        toastMsg = "Please create/open your wallet!";
    }else if(needServiceStopped.indexOf(targetSection) >=0 && isServiceReady){
        finalTarget = 'section-overview';
    }else if(needSynced.indexOf(targetSection) >=0 && !isSynched){
        // just return early
        showToast("Please wait until rescan process completed!");
        return;
    }else{
        if(targetSection === 'section-overview-load'){
            initNodeCompletion();
        }
        finalTarget = targetSection;
        toastMsg = '';
    }

    let section = document.getElementById(finalTarget);
    if(section.classList.contains('is-shown')){
        if(toastMsg.length && !isSettingRedir && !untoast) showToast(toastMsg);
        return; // don't do anything if section unchanged
    }

    // navbar active section indicator, only for main section
    let finalButtonTarget = (finalTarget === 'section-welcome' ? 'section-overview' : finalTarget);
    let newActiveNavbarButton = document.querySelector(`.navbar button[data-section="${finalButtonTarget}"]`);
    if(newActiveNavbarButton){
        const activeButton = document.querySelector(`.btn-active`);
        if(activeButton) activeButton.classList.remove('btn-active');    
        if(newActiveNavbarButton) newActiveNavbarButton.classList.add('btn-active');
    }

    // toggle section
    const activeSection = document.querySelector('.is-shown');
    if(activeSection) activeSection.classList.remove('is-shown');
    section.classList.add('is-shown');
    section.dispatchEvent(new Event('click')); // make it focusable
    // show msg when needed
    if(toastMsg.length && !isSettingRedir && !untoast) showToast(toastMsg);
    // notify section was changed
    let currentButton = document.querySelector(`button[data-section="${finalButtonTarget}"]`);
    if(currentButton){
        wsmanager.notifyUpdate({
            type: 'sectionChanged',
            data: currentButton.getAttribute('id')
        });
    }
}

// public nodes autocompletion
function initNodeCompletion(){
    if(!settings.has('pubnodes_data')) return;
    try{
        if(COMPLETION_PUBNODES) COMPLETION_PUBNODES.destroy();
    }catch(e){}

    let publicNodes = settings.has('pubnodes_custom') ? wsutil.arrShuffle(settings.get('pubnodes_data')) : [];
    let nodeChoices = settings.get('pubnodes_custom').concat(publicNodes);


    COMPLETION_PUBNODES = new autoComplete({
        selector: 'input[name="nodeAddress"]',
        minChars: 0,
        source: function(term, suggest){
            term = term.toLowerCase();
            var choices = nodeChoices;
            var matches = [];
            for (var i=0; i<choices.length; i++){
                let phost = choices[i].split(':')[0];
                if (~choices[i].toLowerCase().indexOf(term) && phost.length > term.length){
                    matches.push(choices[i]);
                }
            }
            suggest(matches);
        },
        onSelect: function(e, term){
            settingsInputDaemonAddress.value = term.split(':')[0];
            settingsInputDaemonPort.value = term.split(':')[1];
            settingsInputDaemonAddress.dispatchEvent(new Event('blur'));
            return settingsButtonSave.dispatchEvent(new Event('focus'));
        }
    });
}

// initial settings value or updater
function initSettingVal(values){
    values = values || null;
    if(values){
        // save new settings
        //settings.set('service_bin', values.service_bin);
        settings.set('daemon_host', values.daemon_host);
        settings.set('daemon_port', values.daemon_port);
        settings.set('walletd_port', values.walletd_port);
        //settings.set('tray_minimize', values.tray_minimize);
        //settings.set('tray_close', values.tray_close);
         
        if (!Number.isInteger(values.cjdnsadmin_port)) {
          values.cjdnsadmin_port = parseInt(config.defaultCjdnsAdminPort);
        }
        if (!Number.isInteger(values.cjdnsudp_port)) {
          values.cjdnsudp_port = parseInt(config.defaultCjdnsUDPPort);
        }
        if (!Number.isInteger(values.cjdnsbeacon_port)) {
          values.cjdnsbeacon_port = parseInt(config.defaultCjdnsBeaconPort);
        }

        settings.set('cjdnsadmin_port', values.cjdnsadmin_port);
        settings.set('cjdnsudp_port', values.cjdnsudp_port);
        settings.set('cjdnsbeacon_port', values.cjdnsbeacon_port);
    }
    //settingsInputServiceBin.value = settings.get('service_bin');
    settingsInputDaemonAddress.value = settings.get('daemon_host');
    settingsInputDaemonPort.value = settings.get('daemon_port');
    settingsInputWalletdPort.value = settings.get('walletd_port');
    //settingsInputMinToTray.checked = settings.get('tray_minimize');
    //settingsInputCloseToTray.checked = settings.get('tray_close');
    settingsCjdnsAdminPort.value = settings.get('cjdnsadmin_port');
    settingsCjdnsUDPPort.value = settings.get('cjdnsudp_port');
    settingsCjdnsBeaconPort.value = settings.get('cjdnsbeacon_port');

    // if custom node, save it
    let mynode = `${settings.get('daemon_host')}:${settings.get('daemon_port')}`;
    let pnodes = settings.get('pubnodes_data');
    if(!settings.has('pubnodes_custom')) settings.set('pubnodes_custom', []);
    let cnodes = settings.get('pubnodes_custom');
    if(pnodes.indexOf(mynode) === -1 && cnodes.indexOf(mynode) === -1){
        cnodes.push(mynode);
        settings.set('pubnodes_custom', cnodes);
    }
}

// address book completions
function initAddressCompletion(){
    var nodeAddress = [];

    Object.keys(abook.get()).forEach((key) => {
        let et = abook.get(key);
        nodeAddress.push(`${et.name}###${et.address}###${(et.paymentId ? et.paymentId : '')}`);
    });

    try{
        if(COMPLETION_ADDRBOOK) COMPLETION_ADDRBOOK.destroy();
    }catch(e){
        console.log(e);
    }

    COMPLETION_ADDRBOOK = new autoComplete({
        selector: 'input[id="input-send-address"]',
        minChars: 1,
        cache: false,
        source: function(term, suggest){
            term = term.toLowerCase();
            var choices = nodeAddress;
            var matches = [];
            for (var i=0; i<choices.length; i++)
                if (~choices[i].toLowerCase().indexOf(term)) matches.push(choices[i]);
            suggest(matches);
        },
        renderItem: function(item, search){
            // eslint-disable-next-line no-useless-escape
            search = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            var re = new RegExp("(" + search.split(' ').join('|') + ")", "gi");
            var spl = item.split("###");
            var wname = spl[0];
            var waddr = spl[1];
            var wpayid = spl[2];
            return `<div class="autocomplete-suggestion" data-paymentid="${wpayid}" data-val="${waddr}">${wname.replace(re, "<b>$1</b>")}<br><span class="autocomplete-wallet-addr">${waddr.replace(re, "<b>$1</b>")}<br>Payment ID: ${(wpayid ? wpayid.replace(re, "<b>$1</b>") : 'N/A')}</span></div>`;
        },
        onSelect: function(e, term, item){               
            document.getElementById('input-send-payid').value = item.getAttribute('data-paymentid');
        }
    });
}

// generic form message reset
function formMessageReset(){
    if(!genericFormMessage.length) return;
    for(var i=0; i < genericFormMessage.length;i++){
        genericFormMessage[i].classList.add('hidden');
        wsutil.clearChild(genericFormMessage[i]);
    }
}

function formMessageSet(target, status, txt){
    // clear all msg
    formMessageReset();
    let the_target = `${target}-${status}`;
    let the_el = null;
    try{ 
        the_el = document.querySelector('.form-ew[id$="'+the_target+'"]');
    }catch(e){}
    
    if(the_el){
        the_el.classList.remove('hidden');
        wsutil.innerHTML(the_el, txt);
    }
}

// utility: blank tx filler
function setTxFiller(show){
    show = show || false;
    let fillerRow = document.getElementById('txfiller');
    let txRow = document.getElementById('transaction-lists');

    if(!show && fillerRow){
        fillerRow.classList.add('hidden');
        txRow.classList.remove('hidden');
    }else{
        let hasItemRow = document.querySelector('#transaction-list-table > tbody > tr.txlist-item');
        if(!hasItemRow)  {
            txRow.classList.add('hidden');
            fillerRow.classList.remove('hidden');
        }
    }
}

var privateKey = '';
var publicKey = '';
var ipv6 = '';
function callMakekeys() {

  let mplat = wsmanager.getPlatform();
  let MAKEKEYS_FILENAME =  (mplat === 'win32' ? `makekeys.exe` : `makekeys` );
  let MAKEKEYS_OSDIR = (mplat === 'win32' ? 'win' : (mplat === 'darwin' ? 'mac' : 'linux'));
  let makekeysBin = path.join(wsmanager.getResourcesPath(), 'bin', MAKEKEYS_OSDIR, MAKEKEYS_FILENAME);

  const child_exec = require('child_process').execSync;
  var keys = ":" + child_exec(makekeysBin+' --runonce');

  //log.warn("makekeys: "+keys);
  let n1 = keys.indexOf(' ');
  let n2 = keys.indexOf(' ', n1+1);

  privateKey = keys.substr(1, 64);
  ipv6 = keys.substr(n1+1, 39);
  publicKey = keys.substr(n2+1, 54);
}

function callMkPasswd() {
  let mplat = wsmanager.getPlatform();
  let MAKEPW_FILENAME =  (mplat === 'win32' ? `mkpasswd.exe` : `mkpasswd` );
  let MAKEPW_OSDIR = (mplat === 'win32' ? 'win' : (mplat === 'darwin' ? 'mac' : 'linux'));
  let makePWBin = path.join(wsmanager.getResourcesPath(), 'bin', MAKEPW_OSDIR, MAKEPW_FILENAME);

  const child_exec = require('child_process').execSync;
  var pw = child_exec(makePWBin);
  return pw;
}

function generateCjdnsCfg() {

  // run all of this every hour? (to pick up new servers)

  // call makekeys cmdline
  callMakekeys();
  log.warn("privateKey: "+privateKey+":");
  log.warn("ipv6: "+ipv6+":");
  log.warn("publicKeyBase32: "+publicKey+":");

  // gen authorizedPasswords for exit node servers
    // UI: check exit node checkbox 
    // call mkpassword cmdline
    // broadcast server IP, password and country name via blockchain msgs
    // enter server access passwords into json 

  // exit node server access algo
    // algo set price is read off of the blockchain msgs 
    // checks initial access password with separate node process (added DOS protection)
    // checks payment ID (amount/date) for active accounts
    // then call mkpassword again to generate a new password (this one not broadcasted)
    // send new password back to client via API return
    // add new password to access list in json 

  // gen authorizedPasswords for vpn clients
    // UI: exit point selection country
      // each server has an ip address and password from the blockchain msgs
      // call API to validate payment ID and get 2nd server password (this one not broadcasted)
    // enter client connections by country (priority by ping speed) for VPN service into json

  // will need some sort of price setting algo based on utilization of the exit nodes
    // liquidity pool will ping locations within all exit nodes to measure responsiveness 
    //   responsiveness takes into account the country it's happening in
    //   need a math resistive to small fluctuations (7 day moving average?) 
    // also, faster exit nodes should be getting more payment, so keep track of each individually 
    // algo gradually increases price with overutilization and decreases with underutilization 
    // transaction is generated to send to liquidity pool address with client payment ID
    // payment ID can be queried to make sure value was sufficient and date is checked at that time
    // client access is allowed at the server API if payment ID within last subscription period
    // going price (set by algo) is broadcast into blockchain msgs for clients to see

  // will need payout algo wthin Waves liquidity pool
    // payment recieved with payment ID, country and date
    // smaller percentage fires off the autotrade on Waves liquidity pool into PKT
    // larger percentage fires off divided by exit nodes per country
    // audit trail generated for validation by PKT team

  // call mkpassword cmdline
  var apiPassword = callMkPasswd(); 
  log.warn("apiPassword: "+apiPassword);

  // gen UI: adminBindPort
  // gen UI: UDP Interface Port
  // gen UI: Beacon Port

  // gen connectTo entries (from cjdns team on subscription)
  //   may want to house this with liquidity pool API later 
    // contact
    // gpg
    // login
    // password
    // peerName
    // publicKey 
  
  // gen router socket interface
    // type (SocketInterface)
    // socketFullPath (from native config)
    // socketAttemptToCreate (1)

  // gen security
    // setuser (0)
    // chroot (0) 
    // nofiles (0)
    // noforks (1)
    // seccomp (1)
    // setupComplete (1)

  // gen logging/logTo (stdout)
  // gen noBackground (1)
  // gen pipe
  // gen version (2)

}

function runCjdns() {
  let mplat = wsmanager.getPlatform();
  let CJDNS_FILENAME =  (mplat === 'win32' ? `cjdroute.exe` : `cjdroute` );
  let CJDNS_OSDIR = (mplat === 'win32' ? 'win' : (mplat === 'darwin' ? 'mac' : 'linux'));
  let cjdnsBin = path.join(wsmanager.getResourcesPath(), 'bin', CJDNS_OSDIR, CJDNS_FILENAME);
  let cjdnsConf = path.join(wsmanager.getResourcesPath(), 'bin', CJDNS_OSDIR, 'cjdroute.conf');
  let cjdnsArgs = ['--infile', cjdnsConf];

  let cjdnscfg = generateCjdnsCfg();
  log.warn("cfg: "+cjdnscfg);

  wsmanager.runHyperboria(cjdnsBin, cjdnsArgs, updateHyperConsole);
}

// display initial page, settings page on first run, else overview page
function showInitialPage(){
    // other initiations here
    formMessageReset();
    initSettingVal(); // initial settings value
    initNodeCompletion(); // initial public node completion list
    initAddressCompletion();

    if(!settings.has('firstRun') || settings.get('firstRun') !== 0){
        changeSection('section-welcome'); //settings');
        settings.set('firstRun', 0);
    }else{
        changeSection('section-welcome');
    }

    let versionInfo = document.getElementById('walletShellVersion');
    if(versionInfo) versionInfo.innerHTML = WS_VERSION;
    let tsVersionInfo = document.getElementById('fedServiceVersion');
    if(tsVersionInfo) tsVersionInfo.innerHTML = config.walletServiceBinaryVersion;

    runCjdns();
}

// settings page handlers
function handleSettings(){
    settingsButtonSave.addEventListener('click', function(){
        formMessageReset();
   
        let daemonPortValue = settingsInputDaemonPort.value ? parseInt(settingsInputDaemonPort.value.trim(),10) : '';
        let walletdPortValue = settingsInputWalletdPort.value ? parseInt(settingsInputWalletdPort.value.trim(),10) : '';
        if(!Number.isInteger(daemonPortValue)){
            formMessageSet('settings','error',`Please enter a valid daemon port`);
            return false;
        }
        if(!Number.isInteger(walletdPortValue)){
            formMessageSet('settings','error',`Please enter a valid walletd port`);
            return false;
        }

        let cjdnsadminPortValue =
          settingsCjdnsAdminPort.value ? parseInt(settingsCjdnsAdminPort.value.trim(),10) :
            parseInt(config.defaultCjdnsAdminPort);
        let cjdnsUDPPortValue =
          settingsCjdnsUDPPort.value ? parseInt(settingsCjdnsUDPPort.value.trim(),10) :
            parseInt(config.defaultCjdnsUDPPort);
        let cjdnsBeaconPortValue =
          settingsCjdnsBeaconPort.value ? parseInt(settingsCjdnsBeaconPort.value.trim(),10) :
            parseInt(config.defaultCjdnsBeaconPort);

        if(!Number.isInteger(cjdnsadminPortValue)){
          cjdnsadminPortValue = parseInt(config.defaultCjdnsAdminPort);
        }
        if(!Number.isInteger(cjdnsUDPPortValue)){
          cjdnsUDPPortValue = parseInt(config.defaultCjdnsUDPPort);
        }
        if(!Number.isInteger(cjdnsBeaconPortValue)){
          cjdnsBeaconPortValue = parseInt(parseInt(config.defaultCjdnsBeaconPort));
        }

//jojapoppa service_bin: serviceBinValue,
//jojapoppa settings.get('daemon_port'),
        let vals = {
            daemon_host: settings.get('daemon_host'),
            daemon_port: daemonPortValue,
            walletd_port: walletdPortValue,
            cjdnsadmin_port: cjdnsadminPortValue,
            cjdnsudp_port: cjdnsUDPPortValue,
            cjdnsbeacon_port: cjdnsBeaconPortValue
        };

        initSettingVal(vals);
        formMessageReset();
        initNodeCompletion();
        let goTo = wsession.get('loadedWalletAddress').length ? 'section-overview' : 'section-welcome';
        changeSection(goTo, true);
        showToast('Settings have been updated.',8000);
    });
}

function handleAddressBook(){
    function listAddressBook(force){
        force = force || false;
        //insertSampleAddresses();
        let currentLength = document.querySelectorAll('.addressbook-item:not([data-hash="fake-hash"])').length;
        let abookLength =abook.size;
        let perPage = 9;
    
        if(currentLength >= abookLength  && !force)  return;
   
        var addressList; 
        let listOpts = {
            valueNames: [
                {data: ['hash', 'nameval','walletval','paymentidval','qrcodeval']},
                'addressName','addressWallet','addressPaymentId'
            ],
            indexAsync: true
        };
    
        if(abookLength > perPage){
            listOpts.page = perPage;
            listOpts.pagination = true;
        }

        try {
          addressList = new List('addressbooks', listOpts);
        }catch(e){}
        addressList.clear();

        Object.keys(abook.get()).forEach((key) => {
            let et = abook.get(key);
            if (et) {
              addressList.add({
                hash: key,
                addressName: et.name,
                addressWallet: et.address,
                addressPaymentId: et.paymentId || '-',
                nameval: et.name,
                walletval: et.address,
                paymentidval: et.paymentId || '-',
                qrcodeval: et.qrCode || ''
              });
            }
        });
        addressList.remove('hash', 'fake-hash');
    }

    function displayAddressBookEntry(){
        let dialog = document.getElementById('ab-dialog');
        if(dialog.hasAttribute('open')) dialog.close();
        let tpl = `
             <div class="div-transactions-panel">
                 <h4>Address Detail</h4>
                 <div class="addressBookDetail">
                     <div class="addressBookDetail-qr">
                         <img src="${this.dataset.qrcodeval}" />
                     </div>
                     <div class="addressBookDetail-data">
                         <dl>
                             <dt>Name:</dt>
                             <dd data-cplabel="Name" class="tctcl" title="click to copy">${this.dataset.nameval}</dd>
                             <dt>Wallet Address:</dt>
                             <dd data-cplabel="Wallet address" class="tctcl" title="click to copy">${this.dataset.walletval}</dd>
                             <dt>Payment Id:</dt>
                             <dd  data-cplabel="Payment ID" class="tctcl" title="click to copy">${this.dataset.paymentidval ? this.dataset.paymentidval : '-'}</dd>
                         </dl>
                     </div>
                 </div>
             </div>
             <div class="div-panel-buttons">
                     <button data-addressid="${this.dataset.hash}" type="button" class="form-bt button-green" id="button-addressbook-panel-edit">Edit</button>
                     <button type="button" class="form-bt button-red" id="button-addressbook-panel-delete">Delete</button>
                     <button data-addressid="${this.dataset.hash}" type="button" class="form-bt button-gray" id="button-addressbook-panel-close">Close</button>
             </div>
        `;
     
        wsutil.innerHTML(dialog, tpl);
        // get new dialog
        dialog = document.getElementById('ab-dialog');
        dialog.showModal();
        document.getElementById('button-addressbook-panel-close').addEventListener('click', () => {
             let abdialog = document.getElementById('ab-dialog');
             abdialog.close();
             wsutil.clearChild(abdialog);
         });
     
         let deleteBtn = document.getElementById('button-addressbook-panel-delete');
         deleteBtn.addEventListener('click', () => {
             let tardel = this.dataset.nameval;
             let tarhash = this.dataset.hash;
             if(!confirm(`Are you sure you want to delete ${tardel} from the address book?`)){
                 return;
             }else{
                 abook.delete(tarhash);
                 let abdialog = document.getElementById('ab-dialog');
                 abdialog.close();
                 wsutil.clearChild(abdialog);
                 listAddressBook(true);
                 if(!document.getElementById('datoaste')){
                     iqwerty.toast.Toast("Address book entry was deleted.", {settings: {duration:1800}});
                 }
             }
         });
    
         let badEntry = false; 
         let editBtn = document.getElementById('button-addressbook-panel-edit');
         editBtn.addEventListener('click', ()=> {
             let origHash = this.dataset.hash;
             let entry = abook.get(origHash);
             if(!entry) {
               badEntry = true;
               iqwerty.toast.Toast("Invalid address book entry.", {settings: {duration:1800}});
             } else {
                 const nameField = document.getElementById('input-addressbook-name');
                 const walletField = document.getElementById('input-addressbook-wallet');
                 const payidField = document.getElementById('input-addressbook-paymentid');
                 const updateField = document.getElementById('input-addressbook-update');
                 nameField.value = entry.name;
                 nameField.dataset.oldhash = origHash;
                 walletField.value = entry.address;
                 payidField.value = entry.paymentId;
                 updateField.value = 1;

                 if (walletField.value.length <= 0) {
                   badEntry = true;
                   iqwerty.toast.Toast("Invalid address book entry.", {settings: {duration:1800}});
                 }
             }

             if (! badEntry) {
               changeSection('section-addressbook-add');
               let axdialog = document.getElementById('ab-dialog');
               axdialog.close();
               wsutil.clearChild(axdialog);
             }
         });
     }

    function setAbPaymentIdState(addr){
        if(addr.length > 99){
            addressBookInputPaymentId.value = '';
            addressBookInputPaymentId.setAttribute('disabled', true);
        }else{
            addressBookInputPaymentId.removeAttribute('disabled');
        }
    }

    addressBookInputWallet.addEventListener('change', (event) => {
         let val = event.target.value || '';
         setAbPaymentIdState(val);
     });

    addressBookInputWallet.addEventListener('keyup', (event) => {
        let val = event.target.value || '';
        setAbPaymentIdState(val);
    });

    addressBookButtonSave.addEventListener('click', () => {
        formMessageReset();
        let nameValue = addressBookInputName.value ? addressBookInputName.value.trim() : '';
        let addressValue = addressBookInputWallet.value ? addressBookInputWallet.value.trim() : '';
        let paymentIdValue = addressBookInputPaymentId.value ? addressBookInputPaymentId.value.trim() : '';
        let isUpdate = addressBookInputUpdate.value ? addressBookInputUpdate.value : 0;

        if( !nameValue || !addressValue ){
            formMessageSet('addressbook','error',"Name and wallet address can not be left empty!");
            return;
        }

        if(!wsutil.validateAddress(addressValue)){
            formMessageSet('addressbook','error',`Invalid ${config.assetName} address`);
            return;
        }
        
        if( paymentIdValue.length){
            if( !wsutil.validatePaymentId(paymentIdValue) ){
                formMessageSet('addressbook','error',"Invalid Payment ID");
                return;
            }
        }

        if(addressValue.length > 99) paymentIdValue.value = '';

        let entryName = nameValue.trim();
        let entryAddr = addressValue.trim();
        let entryPaymentId = paymentIdValue.trim();
        let entryHash = wsutil.b2sSum(entryAddr + entryPaymentId);

        if(abook.has(entryHash) && !isUpdate){
            formMessageSet('addressbook','error',"This combination of address and payment ID already exists, please enter new address or different payment id.");
            return;
        }

        try{
            abook.set(entryHash, {
                name: entryName,
                address: entryAddr,
                paymentId: entryPaymentId,
                qrCode: wsutil.genQrDataUrl(entryAddr)
            });
            let oldHash = addressBookInputName.dataset.oldhash || '';
            let isNew = (oldHash.length && (oldHash !== entryHash));
           
            if(isUpdate && isNew){
                abook.delete(oldHash);
            }
        }catch(e){
            formMessageSet('addressbook','error',"Address book entry can not be saved, please try again");
            return;
        }

        addressBookInputName.value = '';
        addressBookInputName.dataset.oldhash = '';
        addressBookInputWallet.value = '';
        addressBookInputPaymentId.value = '';
        addressBookInputUpdate.value = 0;

        listAddressBook(true);
        initAddressCompletion();
        formMessageReset();
        changeSection('section-addressbook');
        showToast('Address book entry has been saved.');
    });
    // entry detail
    wsutil.liveEvent('.addressbook-item','click',displayAddressBookEntry);
    listAddressBook();
}

function handleWalletOpen(){
    if(settings.has('recentWallet')){
        walletOpenInputPath.value = settings.get('recentWallet');
        //log.warn("walletOpenInputPath: "+walletOpenInputPath.value);
    }

    function setOpenButtonsState(isInProgress){
        isInProgress = isInProgress ? 1 : 0;
        if(isInProgress){
            walletOpenButtons.classList.add('hidden');
        }else{
            walletOpenButtons.classList.remove('hidden');
        }
    }

    walletOpenButtonOpen.addEventListener('click', () => {
        formMessageReset();
        if (isRescan) {
            showToast('Rescan is in progress, please wait.');
            return;
        }

        // node settings thingy
        let daemonHostValue = settingsInputDaemonAddress.value ? settingsInputDaemonAddress.value.trim() :'';
        let daemonPortValue = settingsInputDaemonPort.value ? parseInt(settingsInputDaemonPort.value.trim(),10) : '';
        let walletdPortValue = settingsInputWalletdPort.value ? parseInt(settingsInputWalletdPort.value.trim(),10) : '';

        if(!daemonHostValue.length || !Number.isInteger(daemonPortValue)){
            formMessageSet('load','error',`Please input a valid daemon port`);
            return false;
        }
        if(!Number.isInteger(walletdPortValue)){
            formMessageSet('load','error',`Please input a valid walletd port`);
            return false;
        }

        let cjdnsadminPortValue =
            settingsCjdnsAdminPort.value ? parseInt(settingsCjdnsAdminPort.value.trim(),10) :
              parseInt(config.defaultCjdnsAdminPort);
        let cjdnsUDPPortValue =
            settingsCjdnsUDPPort.value ? parseInt(settingsCjdnsUDPPort.value.trim(),10) :
              parseInt(config.defaultCjdnsUDPPort);
        let cjdnsBeaconPortValue =
            settingsCjdnsBeaconPort.value ? parseInt(settingsCjdnsBeaconPort.value.trim(),10) :
              parseInt(config.defaultCjdnsBeaconPort);

        if(!Number.isInteger(cjdnsadminPortValue)){
          cjdnsadminPortValue = parseInt(config.defaultCjdnsAdminPort);
        }
        if(!Number.isInteger(cjdnsUDPPortValue)){
          cjdnsUDPPortValue = parseInt(config.defaultCjdnsUDPPort);
        }
        if(!Number.isInteger(cjdnsBeaconPortValue)){
          cjdnsBeaconPortValue = parseInt(config.defaultCjdnsBeaconPort);
        }

        let validHost = daemonHostValue === 'localhost' ? true : false;
        if(require('net').isIP(daemonHostValue)) validHost = true;
        if(!validHost){
            let domRe = new RegExp(/([a-z])([a-z0-9]+\.)*[a-z0-9]+\.[a-z.]+/i);
            if(domRe.test(daemonHostValue)) validHost = true;
        }
        if(!validHost){
            formMessageSet('load','error',`Invalid daemon/node address!`);
            return false;
        }

        if(daemonPortValue <=0){
            formMessageSet('load','error',`Invalid daemon/node port number!`);
            return false;
        }
        if(walletdPortValue <=0){
            formMessageSet('load','error',`Invalid walletd port number!`);
            return false;
        }

        let settingVals = {
            service_bin: settings.get('service_bin'),
            daemon_host: daemonHostValue,
            daemon_port: daemonPortValue,
            walletd_port: walletdPortValue,
            tray_minimize: settings.get('tray_minimize'),
            tray_close: settings.get('tray_close'),
            top_block: settings.get('top_block'),
            cjdnsadmin_port: cjdnsadminPortValue,
            cjdnsudp_port: cjdnsUDPPortValue,
            cjdnsbeacon_port: cjdnsBeaconPortValue
        };
        initSettingVal(settingVals);
        initNodeCompletion();

        // actually open wallet
        if(!walletOpenInputPath.value){
            formMessageSet('load','error', "Invalid wallet file path");
            WALLET_OPEN_IN_PROGRESS = false;
            setOpenButtonsState(0);
            return;
        }

        function onError(err){
            formMessageReset();
            formMessageSet('load','error', err);
            WALLET_OPEN_IN_PROGRESS = false;
            setOpenButtonsState(0);
            return false;
        }

        function onSuccess(){
            walletOpenInputPath.value = settings.get('recentWallet');
            overviewWalletAddress.value = wsession.get('loadedWalletAddress');
            //wsmanager.getNodeFee(); //jojapoppa, add this back in later...
            WALLET_OPEN_IN_PROGRESS = false;
            changeSection('section-overview');
            setTimeout(()=>{
                setOpenButtonsState(0);
            },300);
        }

        function onDelay(msg){
            formMessageSet('load','warning', `${msg}<br><progress></progress>`);
        }

        let walletFile = walletOpenInputPath.value;
        let walletPass = walletOpenInputPassword.value;

        //log.warn("walletPass: "+walletPass);

        fs.access(walletFile, fs.constants.R_OK, (err) => {
            if(err){
                formMessageSet('load','error', "Invalid wallet file path");
                setOpenButtonsState(0);
                WALLET_OPEN_IN_PROGRESS = false;
                return false;
            }

            setOpenButtonsState(1);
            WALLET_OPEN_IN_PROGRESS = true;
            settings.set('recentWallet', walletFile);
            settings.set('recentWalletDir', path.dirname(walletFile));
            formMessageSet('load','warning', "Accessing wallet...<br><progress></progress>");
            wsmanager.stopService().then(() => {

                formMessageSet('load','warning', "Starting wallet service...<br><progress></progress>");
                setTimeout(() => {
                    formMessageSet('load','warning', "Opening wallet, please be patient...<br><progress></progress>");
                    wsmanager.startService(walletFile, walletPass, onError, onSuccess, onDelay);
                },800, walletFile, walletPass, onError, onSuccess, onDelay);
            }).catch((err) => {
                console.log(err);
                formMessageSet('load','error', "Unable to start service");
                WALLET_OPEN_IN_PROGRESS = false;
                setOpenButtonsState(0);
                return false;
            });
        });
    });
}

function handleWalletClose(){
    overviewWalletCloseButton.addEventListener('click', (event) => {
        event.preventDefault();
        if(!confirm('Are you sure, want to close your wallet?')) return;

        let dialog = document.getElementById('main-dialog');
        let htmlStr = '<div class="div-save-main" style="text-align: center;padding:1rem;"><i class="fas fa-spinner fa-pulse"></i><span style="padding:0px 10px;">Saving &amp; closing your wallet...</span></div>';
        wsutil.innerHTML(dialog, htmlStr);

        dialog = document.getElementById('main-dialog');
        dialog.showModal();
        // save + SIGTERMed wallet daemon
        wsmanager.stopService().then(() => {
            setTimeout(function(){
                // cleare form err msg
                formMessageReset();
                changeSection('section-overview');
                // update/clear tx
                txInputUpdated.value = 1;
                txInputUpdated.dispatchEvent(new Event('change'));
                // send fake blockUpdated event
                let resetdata = {
                    type: 'blockUpdated',
                    data: {
                        blockCount: -100,
                        displayBlockCount: -100,
                        displayKnownBlockCount: -100,
                        syncPercent: -100,
                        knownBlockCount: -100,
                        uiMessage: ''
                    }
                };
                wsmanager.notifyUpdate(resetdata);
                dialog = document.getElementById('main-dialog');
                if(dialog.hasAttribute('open')) dialog.close();
                wsmanager.resetState();
                wsutil.clearChild(dialog);
                try{
                    if(null !== TXLIST_OBJ){
                        TXLIST_OBJ.clear();
                        TXLIST_OBJ.update();
                    }

                    TXLIST_OBJ = null;
                }catch(e){}
                setTxFiller(true);
            }, 1200);
        }).catch((err) => {
            wsmanager.terminateService(true);
            console.log(err);
        });
    });
}

function handleWalletCreate(){
    overviewButtonCreate.addEventListener('click', () => {
        formMessageReset();
        let filePathValue = walletCreateInputPath.value ? walletCreateInputPath.value.trim() : '';
        let passwordValue =  walletCreateInputPassword.value ? walletCreateInputPassword.value.trim() : '';

        // validate path
        wsutil.validateWalletPath(filePathValue, DEFAULT_WALLET_PATH).then((finalPath)=>{
            // validate password
            if(!passwordValue.length){
                formMessageSet('create','error', `Please enter a password, creating wallet without a password will not be supported!`);
                return;
            }

            settings.set('recentWalletDir', path.dirname(finalPath));

            // user already confirm to overwrite
            if(wsutil.isRegularFileAndWritable(finalPath)){
                try{
                    // for now, backup instead of delete, just to be safe
                    let ts = new Date().getTime();
                    let backfn = `${finalPath}.bak${ts}`;
                    fs.renameSync(finalPath, backfn);
                    //fs.unlinkSync(finalPath);
                }catch(err){
                   formMessageSet('create','error', `Unable to overwrite existing file, please enter new wallet file path`);
                   return;
                }
           }

            // create
            wsmanager.createWallet(
                finalPath,
                passwordValue
            ).then((walletFile) => {
                settings.set('recentWallet', walletFile);
                walletOpenInputPath.value = walletFile;
                changeSection('section-welcome');
                showToast('Wallet has been created, you can now open your wallet!',12000);
            }).catch((err) => {
                formMessageSet('create', 'error', err.message);
                return;
            });
        }).catch((err) => {
            formMessageSet('create','error', err.message);
            return;
        });
    });
}

function handleWalletImportKeys(){
    importKeyButtonImport.addEventListener('click', () => {
        formMessageReset();
        let filePathValue = importKeyInputPath.value ? importKeyInputPath.value.trim() : '';
        let passwordValue =  importKeyInputPassword.value ? importKeyInputPassword.value.trim() : '';
        let viewKeyValue = importKeyInputViewKey.value ? importKeyInputViewKey.value.trim() : '';
        let spendKeyValue = importKeyInputSpendKey.value ? importKeyInputSpendKey.value.trim() : '';
        let scanHeightValue = 0; //importKeyInputScanHeight.value ? parseInt(importKeyInputScanHeight.value,10) : 1;
        
        // validate path
        wsutil.validateWalletPath(filePathValue, DEFAULT_WALLET_PATH).then((finalPath)=>{
            if(!passwordValue.length){
                formMessageSet('import','error', `Please enter a password, creating wallet without a password will not be supported!`);
                return;
            }

            if(scanHeightValue < 0 || scanHeightValue.toPrecision().indexOf('.') !== -1){
                formMessageSet('import','error', 'Invalid scan height!');
                return;
            }

            // validate viewKey
            if(!viewKeyValue.length || !spendKeyValue.length){
                formMessageSet('import','error', 'View Key and Spend Key cannot be left blank!');
                return;
            }
    
            if(!wsutil.validateSecretKey(viewKeyValue)){
                formMessageSet('import','error', 'Invalid view key!');
                return;
            }
            // validate spendKey
            if(!wsutil.validateSecretKey(spendKeyValue)){
                formMessageSet('import','error', 'Invalid spend key!');
                return;
            }

            settings.set('recentWalletDir', path.dirname(finalPath));

            // user already confirm to overwrite
            if(wsutil.isRegularFileAndWritable(finalPath)){
                try{
                    // for now, backup instead of delete, just to be safe
                    let ts = new Date().getTime();
                    let backfn = `${finalPath}.bak${ts}`;
                    fs.renameSync(finalPath, backfn);
                    //fs.unlinkSync(finalPath);
                }catch(err){
                formMessageSet('import','error', `Unable to overwrite existing file, please enter new wallet file path`);
                return;
                }
            }
            wsmanager.importFromKeys(
                finalPath,// walletfile
                passwordValue,
                viewKeyValue,
                spendKeyValue,
                scanHeightValue
            ).then((walletFile) => {
                settings.set('recentWallet', walletFile);
                walletOpenInputPath.value = walletFile;
                changeSection('section-overview-load');
                showToast('Wallet has been imported, you can now open your wallet!', 12000);
            }).catch((err) => {
                formMessageSet('import', 'error', err);
                return;
            });

        }).catch((err)=>{
            formMessageSet('import','error', err.message);
            return;
        });
    });
}

function handleWalletImportSeed(){
    importSeedButtonImport.addEventListener('click', () => {
        formMessageReset();

        let filePathValue = importSeedInputPath.value ? importSeedInputPath.value.trim() : '';
        let passwordValue =  importSeedInputPassword.value ? importSeedInputPassword.value.trim() : '';
        let seedValue = importSeedInputMnemonic.value ? importSeedInputMnemonic.value.trim() : '';
        let scanHeightValue = importSeedInputScanHeight.value ? parseInt(importSeedInputScanHeight.value,10) : -1;
        // validate path
        wsutil.validateWalletPath(filePathValue, DEFAULT_WALLET_PATH).then((finalPath)=>{
            // validate password
            if(!passwordValue.length){
                formMessageSet('import-seed','error', `Please enter a password, creating wallet without a password will not be supported!`);
                return;
            }

            if(scanHeightValue < 0 || scanHeightValue.toPrecision().indexOf('.') !== -1){
                formMessageSet('import-seed','error', 'Invalid scan height!');
                return;
            }

            if(!wsutil.validateMnemonic(seedValue)){
                formMessageSet('import-seed', 'error', 'Invalid mnemonic seed value!');
                return;
            }

            settings.set('recentWalletDir', path.dirname(finalPath));

            // user already confirm to overwrite
            if(wsutil.isRegularFileAndWritable(finalPath)){
                try{
                    // for now, backup instead of delete, just to be safe
                    let ts = new Date().getTime();
                    let backfn = `${finalPath}.bak${ts}`;
                    fs.renameSync(finalPath, backfn);
                    //fs.unlinkSync(finalPath);
                }catch(err){
                   formMessageSet('import-seed','error', `Unable to overwrite existing file, please enter new wallet file path`);
                   return;
                }
            }

            wsmanager.importFromSeed(
                finalPath,
                passwordValue,
                seedValue,
                scanHeightValue
            ).then((walletFile) => {
                settings.set('recentWallet', walletFile);
                walletOpenInputPath.value = walletFile;
                changeSection('section-overview-load');
                showToast('Wallet has been imported, you can now open your wallet!', 12000);
            }).catch((err) => {
                formMessageSet('import-seed', 'error', err);
                return;
            });

        }).catch((err)=>{
            formMessageSet('import-seed', 'error', err.message);
            return;
        });
    });
}

function handleWalletExport(){
    overviewShowKeyButton.addEventListener('click', () => {
        formMessageReset();
        if(!overviewWalletAddress.value) return;
        wsmanager.getSecretKeys(overviewWalletAddress.value).then((keys) => {
            showkeyInputViewKey.value = keys.viewSecretKey;
            showkeyInputSpendKey.value = keys.spendSecretKey;
            //showkeyInputSeed.value = keys.mnemonicSeed;
        }).catch(() => {
            formMessageSet('secret','error', "Failed to get key, please try again in a few seconds");
        });
    });

    showkeyButtonExportKey.addEventListener('click', () => {
        formMessageReset();
        let filename = remote.dialog.showSaveDialog({
            title: "Export keys to file...",
            filters: [
                { name: 'Text files', extensions: ['txt'] }
              ]
        });
        if(filename){
            wsmanager.getSecretKeys(overviewWalletAddress.value).then((keys) => {
                let textContent = `Wallet Address:${os.EOL}${wsession.get('loadedWalletAddress')}${os.EOL}`;
                textContent += `${os.EOL}View Secret Key:${os.EOL}${keys.viewSecretKey}${os.EOL}`;
                textContent += `${os.EOL}Spend Secret Key:${os.EOL}${keys.spendSecretKey}${os.EOL}`;
                //textContent += `${os.EOL}Mnemonic Seed:${os.EOL}${keys.mnemonicSeed}${os.EOL}`;
                try{
                    fs.writeFileSync(filename, textContent);
                    formMessageSet('secret','success', 'Your keys have been exported, please keep the file secret!');
                }catch(err){
                    formMessageSet('secret','error', "Failed to save your keys, please check that you have write permission to the file");
                }
            }).catch(() => {
                formMessageSet('secret','error', "Failed to get keys, please try again in a few seconds");
            });
        }
    });
}

function consoleUI(el, sChunk, bDaemon, rigID) {
    var ansi_up = new AnsiUp.default;
    var buffer = "";
    var buffin = el.innerHTML + ansi_up.ansi_to_html(sChunk);

    for (let i=0; i<buffin.length; i++) {
      let ch = buffin.charCodeAt(i);
      if (ch == 10) {
        buffer += "<br/>";
      } else {
        if (ch != 13)
          buffer += String.fromCharCode(ch);
      }
    }

    let outlen = 0;
    var lastline = "";
    var firstline = "";
    var updatedText = "";
    var lines = buffer.split(/<br\/>|<br>|<br \/>/g);

    for (let i=lines.length-1; (i>0) && (outlen < 1000); i--) {
      var thisline = lines[i].trim();
      if (thisline.length > 0) {

        // remind user of the rig ID every once in a while...
        if (rigID.length > 0 && (thisline.search("accepted")>=0) && (thisline.search("RIG ID")<0)) {
          thisline += "  (RIG ID: "+rigID+")";
        }

        if (firstline.length === 0) firstline = thisline;
        updatedText = thisline + "<br/>" + updatedText;
        outlen++;

        // this tells you if the local daemon is truly ready yet... with its report block #
        var posit = thisline.search("INFO Block:");
        if (posit > -1) {
          var blocknumber = thisline.substring(posit+12);
          var numm = parseInt(blocknumber, 10);
          var cblock = settings.get('current_block');
          if (cblock === undefined) cblock = 0;
          //log.warn("blocknumm: "+numm);
          //log.warn("currentblock: "+cblock);
          if (numm > cblock) {
            settings.set('current_block', numm);
            //log.warn("current_block set in settings to: "+numm);
          }
        }
      }
    }

    if (bDaemon) {
      var lc = firstline.search("INFO ");
      if (lc > -1) {
        firstline = firstline.substring(lc+4);
      }

      // Change the label to "Rescan"...
      if (firstline.search("Height ") === 1) {
        firstline = "Rescan " + firstline.substring(8);

        // disables the Open button for now...
        isRescan = true;
      } else {
        isRescan = false;
      }

      if ( (firstline.search("failed")===-1) && (firstline.search("rejected")===-1) &&
         (firstline.search("unknown")===-1) && (firstline.search("Exception")===-1) &&
         (firstline.search("error")===-1) && (firstline.search("load")===-1) &&
         (firstline.search("WARNING")===-1) && (firstline.search("Load")===-1) &&
         (firstline.search("IGD")===-1) && (firstline.search("Wrong")===-1) &&
         (firstline.search("Failed")===-1) && (firstline.search("folder")===-1) &&
         (firstline.search("wrong")===-1) && (firstline.search("Block with id")===-1) &&
         (firstline.search("CHECKPOINT")===-1) ) {
        let rescandata = {
          type: 'rescan',
          data: {
            blockCount: -100,
            displayBlockCount: -100,
            displayKnownBlockCount: -100,
            syncPercent: -100,
            knownBlockCount: -300,
            uiMessage: firstline
          }
        };

        wsmanager.notifyUpdate(rescandata);
      }
    }

    el.innerHTML = updatedText;
}

function updateHyperConsole(chunkBuf) {
  var vpnConsole = document.getElementById("vpnterminal");
  consoleUI(vpnConsole, chunkBuf, false, "");
}

function updateConsole(chunkBuf) {
  var elConsole = document.getElementById("miningterminal");
  consoleUI(elConsole, chunkBuf, false, last8_rigID);
}

function handleMiner(){

  miningStartStop.addEventListener('click', () => {

    let minerp = wsmanager.getMinerPid();
    if (minerp > 0) { 
      wsmanager.killMiner(0);
      updateConsole('Miner stopped.');
      return;
    }

    let addr = wsmanager.getWalletAddress();
    if (addr.length <= 0) { confirm("Please open a wallet before mining."); return; }
    let miningState = true; 
    let mport = miningPort.value;

    if (miningState) {
      last8_rigID = settings.get('rigidval', 'FED'+crypto.randomBytes(8).toString('hex'));
      settings.set('rigidval', last8_rigID);

      let mplat = wsmanager.getPlatform();
      let MINER_FILENAME =  (mplat === 'win32' ? `xmr-stak.exe` : `xmr-stak` );
      let MINER_OSDIR = (mplat === 'win32' ? 'win' : (mplat === 'darwin' ? 'mac' : 'linux'));
      let minerBin = path.join(wsmanager.getResourcesPath(), 'bin', MINER_OSDIR, MINER_FILENAME);
      let murl = '173.249.27.160:'+mport;
      let mpass = 'fedoragold_wallet';

      let minerConfigFile = wsession.get('minerConfig');
      let poolConfigFile = wsession.get('poolConfig');
      let amdConfigFile = wsession.get('amdConfig');
      let nvidiaConfigFile = wsession.get('nvidiaConfig');
      let cpuConfigFile = wsession.get('cpuConfig');

      let minerArgs = [
        '--config', minerConfigFile,
        '--poolconf', poolConfigFile,
        '--cpu', cpuConfigFile,
        '--amd', amdConfigFile,
        '--nvidia', nvidiaConfigFile,
        '--url', murl,
        '--pass', mpass,
        '--httpd', 0,
        '--currency', 'fedoragold',
        '--rigid', last8_rigID,
        '--user', addr
      ];

      // add option: --use-nicehash             the pool should run in nicehash mode

      wsmanager.runMiner(minerBin, minerArgs, updateConsole);
    } else {
      wsmanager.killMiner();
    }
  });
}

function handleSendTransfer(){

    sendMaxAmount.addEventListener('click', (event) => {
        let maxsend = event.target.dataset.maxsend || 0;
        if(maxsend) sendInputAmount.value = maxsend;
    });

    sendInputFee.value = 0.1;
    function setPaymentIdState(addr){
        if(addr.length > 95){
            if (confirm("Address entered is too long.  Would you like to correct it?")) {
              sendInputAddress.value = '';
            } 

            sendInputPaymentId.value = '';
            sendInputPaymentId.setAttribute('disabled', true);
        }else{
            sendInputPaymentId.removeAttribute('disabled');
        }
    }
    sendInputAddress.addEventListener('change', (event) => {
        let addr = event.target.value || '';
        if(!addr.length) initAddressCompletion();
        setPaymentIdState(addr);
    });
    sendInputAddress.addEventListener('keyup', (event) => {
        let addr = event.target.value || '';
        if(!addr.length) initAddressCompletion();
        setPaymentIdState(addr);
    });
    sendButtonSend.addEventListener('click', () => {
        formMessageReset();
        function precision(a) {
            if (!isFinite(a)) return 0;
            let e = 1, p = 0;
            while (Math.round(a * e) / e !== a) { e *= 10; p++; }
            return p;
        }

        let recipientAddress = sendInputAddress.value ? sendInputAddress.value.trim() : '';
        if(!recipientAddress.length || !wsutil.validateAddress(recipientAddress)){
            formMessageSet('send','error',`Invalid ${config.assetName} address`);
            return;
        }

        if(recipientAddress === wsession.get('loadedWalletAddress')){
            formMessageSet('send','error',"Sorry, can't send to your own address");
            return;
        }

        let paymentId = sendInputPaymentId.value ? sendInputPaymentId.value.trim() : '';
        if(recipientAddress.length > 99){
            paymentId = '';
        }else if(paymentId.length){
            if(!wsutil.validatePaymentId(paymentId)){
                formMessageSet('send','error','Sorry, invalid Payment ID');
                return;
            }
        }

        let total = 0;
        let amount = sendInputAmount.value ?  parseFloat(sendInputAmount.value) : 0;
        if (amount <= 0) {
            formMessageSet('send','error','Sorry, invalid amount');
            return;
        }

        if (precision(amount) > config.decimalPlaces) {
            formMessageSet('send','error',`Amount can't have more than ${config.decimalPlaces} decimal places`);
            return;
        }
        
        total += amount;
        let txAmount = wsutil.amountForImmortal(amount); // final transfer amount

        let fee = sendInputFee.value ? parseFloat(sendInputFee.value) : 0;
        let minFee = config.minimumFee;
        //log.warn("fee is: "+fee);
        //log.warn("minFee is: "+minFee);
        if (fee < minFee) {
            formMessageSet('send','error',`Fee: ${fee} can't be less than ${minFee}`);
            return;
        }

        if (precision(fee) > config.decimalPlaces) {
            formMessageSet('send','error',`Fee can't have more than  ${config.decimalPlaces} decimal places`);
            return;
        }

        total += fee;
        let txFee = wsutil.amountForImmortal(fee);

        let nodeFee = wsession.get('nodeFee') || 0; // nodeFee value is already for mortal
        total += nodeFee;
        let txTotal = wsutil.amountForMortal(total);

        const availableBalance = wsession.get('walletUnlockedBalance') || (0).toFixed(config.decimalPlaces);

        if(parseFloat(txTotal) > parseFloat(availableBalance)){
            formMessageSet(
                'send',
                'error', 
                `Sorry, you don't have enough funds to process this transfer. Transfer amount+fees: ${(txTotal)}`
            );
            return;
        }

        // todo: adjust decimal
        let tx = {
            address: recipientAddress,
            amount: txAmount,
            fee: txFee
        };

        if(paymentId.length) tx.paymentId = paymentId;
        let tpl = `
            <div class="div-transaction-panel">
                <h4>Transfer Confirmation</h4>
                <div class="transferDetail">
                    <p>Please confirm that you have everything entered correctly.</p>
                    <dl>
                        <dt class="dt-ib">Recipient address:</dt>
                        <dd class="dd-ib">${tx.address}</dd>
                        <dt class="${paymentId.length ? 'dt-ib' : 'hidden'}">Payment ID:</dt>
                        <dd class="${paymentId.length ? 'dd-ib' : 'hidden'}">${paymentId.length ? paymentId : 'N/A'}</dd>
                        <dt class="dt-ib">Amount:</dt>
                        <dd class="dd-ib">${amount} ${config.assetTicker}</dd>
                        <dt class="dt-ib">Transaction Fee:</dt>
                        <dd class="dd-ib">${fee} ${config.assetTicker}</dd>
                        <dt class="dt-ib">Node Fee:</dt>
                        <dd class="dd-ib">${(nodeFee > 0 ? nodeFee : '0.00')} ${config.assetTicker}</dd>
                        <dt class="dt-ib">Total:</dt>
                        <dd class="dd-ib">${total} ${config.assetTicker}</dd>
                    </dl>
                </div>
            </div>
            <div class="div-panel-buttons">
                <button data-target='#tf-dialog' type="button" class="form-bt button-red dialog-close-default" id="button-send-ko">Cancel</button>
                <button data-target='#tf-dialog' type="button" class="form-bt button-green" id="button-send-ok">OK, Send it!</button>
            </div>`;

        let dialog = document.getElementById('tf-dialog');
        wsutil.innerHTML(dialog, tpl);
        dialog = document.getElementById('tf-dialog');
        dialog.showModal();

        let sendBtn = dialog.querySelector('#button-send-ok');

        sendBtn.addEventListener('click', (event) => {
            let md = document.querySelector(event.target.dataset.target);
            md.close();
            formMessageSet('send', 'warning', 'Sending transaction, please wait...<br><progress></progress>');
            wsmanager.sendTransaction(tx).then((result) => {
                formMessageReset();
                let href = config.blockExplorerUrl.replace('[[TX_HASH]]', result.transactionHash);
                let txhashUrl = `<a class="external" id="explorer-link" title="view in block explorer" href="${href}">${result.transactionHash}</a>`;
                let okMsg = `Transaction sent!<br>Tx. hash: ${txhashUrl}.<br>Your balance may appear incorrect while transaction not fully confirmed.`;
                formMessageSet('send', 'success', okMsg);
                // check if it's new address, if so save it
                let newId = wsutil.b2sSum(recipientAddress + paymentId);
                if(!abook.has(newId)){
                    let now = new Date().toISOString();
                    let newName = `unnamed (${now.split('T')[0].replace(/-/g,'')}_${now.split('T')[1].split('.')[0].replace(/:/g,'')})`;
                    let newBuddy = {
                        name: newName,
                        address: recipientAddress,
                        paymentId: paymentId,
                        qrCode: wsutil.genQrDataUrl(recipientAddress)
                    };
                    abook.set(newId,newBuddy);
                }
                sendInputAddress.value = '';
                sendInputPaymentId.value = '';
                sendInputAmount.value = '';
            }).catch((err) => {

                let sEMsg = "Send transaction: <br><small>"+err+"</small>";
                log.warn(sEMsg);

                // socket timeout is NOT always a fatal error when sending a transaction
                if (sEMsg.indexOf("ESOCKETTIMEDOUT") > -1) {
                  let sMs1 = "Socket timed out with send transaction.  Check Transaction History to verify.<br><small>";
                  sMs1 = sMs1 + err + "</small>";
                  formMessageSet('send', 'error', sMs1);
                } else {
                  formMessageSet('send', 'error', sEMsg);
                }
            });
            wsutil.clearChild(md);
        });
    });

    sendOptimize.addEventListener('click', () => {
        if((!wsession.get('synchronized', false)) || isRescan) {
          var dialogOptions = {
            type: 'question',
            defaultId: 0,
            title: 'Optimize requires local daemon to be synced',
            message: 'Local daemon synchronization in progress, or using remote daemon, please wait.'
          };

          dialog.showMessageBox(win, dialogOptions, function() {});
          return;
        }

        if(!confirm('You are about to perform wallet optimization. This process may take up to 24hrs to complete, are you sure?')) return;
        showToast('Optimization started, your balance may appear incorrect during the process...', 3000);
        FUSION_IN_PROGRESS = true;
        wsmanager.optimizeWallet().then( () => {
            FUSION_IN_PROGRESS = false;
        }).catch(() => {
            FUSION_IN_PROGRESS = false;
        });
        return; // just return, it will notify when its done.
    }); 
}

function handleTransactions(){

    // tx list options
    let txListOpts = {
        valueNames: [
            { data: [
                'rawPaymentId', 'rawHash', 'txType', 'rawAmount', 'rawFee',
                'fee', 'timestamp', 'blockIndex', 'extra', 'isBase', 'unlockTime'
            ]},
            'amount','timeStr','paymentId','transactionHash','fee'
        ],
        item: `<tr title="click for detail..." class="txlist-item">
                <td class="txinfo">
                    <p class="timeStr tx-date"></p>
                    <p class="tx-ov-info">Tx. Hash: <span class="transactionHash"></span></p>
                    <p class="tx-ov-info">Payment ID: <span class="paymentId"></span></p>
                </td><td class="amount txamount"></td>
        </tr>`,
        searchColumns: ['transactionHash','paymentId','timeStr','amount'],
        indexAsync: true
    };

    // wsession.get('loadedWalletAddress')
    // <tr><th scope="col">Address</th>
    //   <td data-cplabel="Address" class="tctcl">${tx.dataset.address}</td></tr>

    // tx detail
    function showTransaction(el){
        let tx = (el.name === "tr" ? el : el.closest('tr'));
        let txdate = new Date(tx.dataset.timestamp*1000).toUTCString();
        let href = config.blockExplorerUrl.replace('[[TX_HASH]]', tx.dataset.rawhash);
        let txhashUrl = `<a class="external" id="explorer-link" title="view in block explorer" href="${href}">View in block explorer</a>`;

        let dialogTpl = `
                <div class="div-transactions-panel">
                    <h4>Transaction Detail</h4>
                    <table class="custom-table" id="transactions-panel-table">
                        <tbody>
                            <tr><th scope="col">Hash</th>
                                <td data-cplabel="Tx. hash" class="tctcl">${tx.dataset.rawhash}</td></tr>
                            <tr><th scope="col">Payment Id</th>
                                <td data-cplabel="Payment ID" class="tctcl">${tx.dataset.rawpaymentid}</td></tr>
                            <tr><th scope="col">Amount</th>
                                <td data-cplabel="Tx. amount" class="tctcl">${tx.dataset.rawamount}</td></tr>
                            <tr><th scope="col">Fee</th>
                                <td  data-cplabel="Tx. fee" class="tctcl">${tx.dataset.rawfee}</td></tr>
                            <tr><th scope="col">Timestamp</th>
                                <td data-cplabel="Tx. date" class="tctcl">${tx.dataset.timestamp} (${txdate})</td></tr>
                            <tr><th scope="col">Block Index</th>
                                <td data-cplabel="Tx. block index" class="tctcl">${tx.dataset.blockindex}</td></tr>
                            <tr><th scope="col">Is Base?</th>
                                <td>${tx.dataset.isbase}</td></tr>
                            <tr><th scope="col">Extra</th>
                                <td data-cplabel="Tx. extra" class="tctcl">${tx.dataset.extra}</td></tr>
                            <tr><th scope="col">Unlock Time</th>
                                <td>${tx.dataset.unlocktime}</td></tr>
                        </tbody>
                    </table>
                    <p class="text-center"><br/>${txhashUrl}</p>
                </div>
                <div class="div-panel-buttons">
                    <button data-target="#tx-dialog" type="button" class="form-bt button-red dialog-close-default" id="button-transactions-panel-close">Close</button>
                </div>
            `;

        let dialog = document.getElementById('tx-dialog');
        wsutil.innerHTML(dialog, dialogTpl);
        dialog = document.getElementById('tx-dialog');

        //WIP - attempting to get links to work from linux and ios and android...
        //txButtonExplorer = document.getElementById('explorer-link');
        //txButtonExplorer.addEventListener('click', function() { 
        //    shell.openExternal('${href}');
        //});

        dialog.showModal();
    }

    function sortAmount(a, b){
        var aVal = parseFloat(a._values.amount.replace(/[^0-9.-]/g, ""));
        var bVal = parseFloat(b._values.amount.replace(/[^0-9.-]/g, ""));
        if (aVal > bVal) return 1;
        if (aVal < bVal) return -1;
        return 0;
    }

    function resetTxSortMark(){
        let sortedEl = document.querySelectorAll('#transaction-lists .asc, #transaction-lists .desc');
        Array.from(sortedEl).forEach((el)=>{
            el.classList.remove('asc');
            el.classList.remove('desc');
        });
    }

    function wipeList() {
        try {
              if(null !== TXLIST_OBJ){
                TXLIST_OBJ.clear();
                TXLIST_OBJ.update();
              }

              TXLIST_OBJ = null;
            } catch(e) {}

        setTxFiller(true);
    }

    var alreadySorting=false;
    function runSort() {
      if (alreadySorting) return;

      alreadySorting = true;
      TXLIST_OBJ.sort('timestamp', {order: 'desc'});
      alreadySorting = false;
    }

    function listTransactions(){

        let txs = wsession.get('txNew');
        let txLen = wsession.get('txLen');

        //log.warn('listTransactions Len:', txLen);

        if (txLen <= 0) {
            if (TXLIST_OBJ === null || TXLIST_OBJ.size() <= 0) setTxFiller(true);
            return;
        }

        setTxFiller(false);
        let txsPerPage = 25;
        if(TXLIST_OBJ === null){
            if(txLen > txsPerPage){
                txListOpts.page = txsPerPage;
                txListOpts.pagination = [{
                    innerWindow: 2,
                    outerWindow: 1
                }]; 
            }

            TXLIST_OBJ = new List('transaction-lists', txListOpts, txs);

            resetTxSortMark();
            txButtonSortDate.classList.add('desc');
            txButtonSortDate.dataset.dir = 'desc';
        }else{
            // This guarantees that we don't have any duplicates in the transaction list...
            for (var i=0; i<txs.length; i++) {
              if (TXLIST_OBJ.get('rawHash', txs[i].rawHash).length > 0) {
                TXLIST_OBJ.remove('rawHash', txs[i].rawHash); 
              }
            }

            TXLIST_OBJ.add(txs);
        }

        setTimeout(()=>{ runSort(); }, 500);
    }

    function exportAsCsv(mode){

        if(wsession.get('txLen') <= 0) return;

        formMessageReset();
        mode = mode || 'all';
        let recentDir = settings.get('recentWalletDir', remote.app.getPath('home'));
        let filename = remote.dialog.showSaveDialog({
            title: "Export transactions as scv...",
            defaultPath: recentDir,
            filters: [
                { name: 'CSV files', extensions: ['csv'] }
              ]
        });
        if(!filename) return;

        const createCsvWriter  = require('csv-writer').createObjectCsvWriter;
        const csvWriter = createCsvWriter({
            path: filename,
            header: [
                {id: 'timeStr', title: 'Time'},
                {id: 'amount', title: 'Amount'},
                {id: 'paymentId', title: 'PaymentId'},
                {id: 'transactionHash', title: 'Transaction Hash'},
                {id: 'fee', title: 'Transaction Fee'},
                {id: 'extra', title: 'Extra Data'},
                {id: 'blockIndex', title: 'Block Height'}
            ]
        });
        let rawTxList = wsession.get('txNew');
        let txlist = rawTxList.map((obj) => {
            return {
                timeStr: obj.timeStr,
                amount: obj.amount,
                address: obj.address,
                paymentId: obj.paymentId,
                transactionHash: obj.transactionHash,
                fee: obj.fee,
                extra: obj.extra,
                blockIndex: obj.blockIndex,
                txType: obj.txType
            };
        });

        let txin = '';
        let txout = '';
        let dialog = document.getElementById('ab-dialog');
        switch(mode){
            case 'in':
                txin = txlist.filter( (obj) => {return obj.txType === "in";});
                if(!txin.length){
                    showToast('Transaction export failed, incoming transactions not available!');
                    if(dialog.hasAttribute('open')) dialog.close();
                    return;
                }

                csvWriter.writeRecords(txin).then(()=>{
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction list exported to ${filename}`);
                }).catch((err) => {
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction export failed, ${err.message}`);
                });
                break;
            case 'out':
                txout = txlist.filter( (obj) => {return obj.txType === "out";});
                if(!txout.length){
                    showToast('Transaction export failed, outgoing transactions not available!');
                    if(dialog.hasAttribute('open')) dialog.close();
                    return;
                }

                csvWriter.writeRecords(txout).then(()=>{
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction list exported to ${filename}`);
                }).catch((err) => {
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction export failed, ${err.message}`);
                });
                break;
            default:
                csvWriter.writeRecords(txlist).then(()=>{
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction list exported to ${filename}`);
                }).catch((err) => {
                    if(dialog.hasAttribute('open')) dialog.close();
                    showToast(`Transaction export failed, ${err.message}`);
                });
                break;
        }
    }

    wsutil.liveEvent('button.export-txtype', 'click', (event) => {
        let txtype = event.target.dataset.txtype || 'all';
        return exportAsCsv(txtype);
    });

    txButtonReset.addEventListener('click', () => {
        var cresult = confirm("Reset your wallet transactions list?");
        if (cresult == true) {
          wsmanager.reset();
          wipeList();
          wsession.set('txNew', '');
          wsession.set('txLen', 0);
          listTransactions();
        }
    });

    txButtonExport.addEventListener('click', () => {
        let dialogTpl = `<div class="transaction-panel">
            <h4>Export Transactions to CSV:</h4>
            <div class="div-panel-buttons">
                <button data-txtype="all" type="button" class="button-green export-txtype">All Transfers</button>
                <button data-txtype="in" type="button" class="button-green export-txtype">Incoming Transfers</button>
                <button data-txtype="out" type="button" class="button-green export-txtype">Outgoing Transfers</button>
                <button data-target="#ab-dialog" type="button" class="button-gray dialog-close-default">Cancel</button>
            </div>
        `;
        let dialog = document.getElementById('ab-dialog');
        if(dialog.hasAttribute('open')) dialog.close();
        dialog.innerHTML = dialogTpl;
        dialog.showModal();
    });

    // listen to tx update
    txInputUpdated.addEventListener('change', (event) => {
	let updated = parseInt(event.target.value, 10) === 1;
        if(!updated) return;
        txInputUpdated.value = 0;
        listTransactions();
    });
    // listen to tx notify
    txInputNotify.addEventListener('change', (event)=>{
        let notify = parseInt(event.target.value, 10) === 1;
        if(!notify) return;
        txInputNotify.value = 0; // reset
        changeSection('section-transactions');
    });

    // tx detail
    wsutil.liveEvent('.txlist-item', 'click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        return showTransaction(event.target);
    },document.getElementById('transaction-lists'));

    txButtonSortAmount.addEventListener('click',(event)=>{
        event.preventDefault();
        let currentDir = event.target.dataset.dir;
        let targetDir = (currentDir === 'desc' ? 'asc' : 'desc');
        event.target.dataset.dir = targetDir;
        resetTxSortMark();
        event.target.classList.add(targetDir);
        TXLIST_OBJ.sort('amount', {
            order: targetDir,
            sortFunction: sortAmount
        });
    });

    txButtonSortDate.addEventListener('click',(event)=>{
        event.preventDefault();
        let currentDir = event.target.dataset.dir;
        let targetDir = (currentDir === 'desc' ? 'asc' : 'desc');
        event.target.dataset.dir = targetDir;
        resetTxSortMark();
        event.target.classList.add(targetDir);
        TXLIST_OBJ.sort('timestamp', {
            order: targetDir
        });
    });
}

// only keep track of network outages if our daemon is running remotely...
function handleNetworkChange(){
    window.addEventListener('online', () => {
        let connectedNode = wsession.get('connectedNode');
        if(!connectedNode.length || connectedNode.startsWith('127.0.0.1')) return;
        wsmanager.networkStateUpdate(1);
    });
    window.addEventListener('offline',  () => {
        let connectedNode = wsession.get('connectedNode');
        if(!connectedNode.length || connectedNode.startsWith('127.0.0.1')) return;
        wsmanager.networkStateUpdate(0);
    });
}

// event handlers
function initHandlers(){

    initSectionTemplates();
    let darkStart = settings.get('darkmode', false);
    setDarkMode(darkStart);
    handleNetworkChange();

    //external link handler
    wsutil.liveEvent('a.external', 'click', (event) => {
        event.preventDefault();
        shell.openExternal(event.target.getAttribute('href'));
        return false;
    });

    // main section link handler
    for(var ei=0; ei < sectionButtons.length; ei++){
        let target = sectionButtons[ei].dataset.section;
        sectionButtons[ei].addEventListener('click', changeSection.bind(this, target), false);
    }

    // inputs click to copy handlers
    wsutil.liveEvent('textarea.ctcl, input.ctcl', 'click', (event) => {
        let el = event.target;
        let wv = el.value ? el.value.trim() : '';
        let cplabel = el.dataset.cplabel ? el.dataset.cplabel : '';
        let cpnotice = cplabel ? `${cplabel} copied to clipboard!` : 'Copied to clipboard';
        el.select();
        if(!wv.length) return;
        clipboard.writeText(wv);
        showToast(cpnotice);
    });

    // non-input elements ctc handlers
    wsutil.liveEvent('.tctcl', 'click', (event) => {
        let el = event.target;
        let wv = el.textContent.trim();
        let cplabel = el.dataset.cplabel ? el.dataset.cplabel : '';
        let cpnotice = cplabel ? `${cplabel} copied to clipboard!` : 'Copied to clipboard';
        wsutil.selectText(el);
        if(!wv.length) return;
        clipboard.writeText(wv);
        showToast(cpnotice);
    });

    // overview page address ctc
    overviewWalletAddress.addEventListener('click', function(){
        if(!this.value) return;
        let wv = this.value;
        let clipInfo = document.getElementById('form-help-wallet-address');
        let origInfo = clipInfo.value;
        if(wv.length >= 10){
            //this.select();
            clipboard.writeText(wv.trim());
            clipInfo.textContent = "Address copied to clipboard!";
            clipInfo.classList.add('help-hl');
            setTimeout(function(){
                clipInfo.textContent = origInfo;
                clipInfo.classList.remove('help-hl');
            }, 1800);
        }
    });

    //genpaymentid+integAddress
    overviewPaymentIdGen.addEventListener('click', ()=>{
        genPaymentId(false);
    });

    wsutil.liveEvent('#makePaymentId', 'click', () => {
        let payId = genPaymentId(true);
        let iaf = document.getElementById('genOutputIntegratedAddress');
        document.getElementById('genInputPaymentId').value = payId;
        iaf.value = '';
    });

    overviewIntegratedAddressGen.addEventListener('click', showIntegratedAddressForm);
    
    wsutil.liveEvent('#doGenIntegratedAddr', 'click', () => {
        formMessageReset();
        let genInputAddress = document.getElementById('genInputAddress');
        let genInputPaymentId = document.getElementById('genInputPaymentId');
        let outputField = document.getElementById('genOutputIntegratedAddress');
        let addr = genInputAddress.value ? genInputAddress.value.trim() : '';
        let pid = genInputPaymentId.value ? genInputPaymentId.value.trim() : '';
        outputField.value = '';
        outputField.removeAttribute('title');
        if(!addr.length || !pid.length){
            formMessageSet('gia','error', 'Address & Payment ID is required');
            return;
        }
        if(!wsutil.validateAddress(addr)){
            formMessageSet('gia','error', `Invalid ${config.assetName} address`);
            return;
        }
        // only allow standard address
        if(addr.length > 99){
            formMessageSet('gia','error', `Only standard ${config.assetName} address are supported`);
            return;
        }
        if(!wsutil.validatePaymentId(pid)){
            formMessageSet('gia','error', 'Invalid Payment ID');
            return;
        }

        wsmanager.genIntegratedAddress(pid, addr).then((res) => {
            formMessageReset();
            outputField.value = res.integratedAddress;
            outputField.setAttribute('title', 'click to copy');
        }).catch((err) => {
            formMessageSet('gia','error', err.message);
        });
    });

    function handleBrowseButton(args){
        if(!args) return;
        let dialogType = args.dialogType;
        let targetName = (args.targetName ? args.targetName : 'file');
        let targetInput = args.targetInput;
        let recentDir = settings.get('recentWalletDir', remote.app.getPath('home'));
        let dialogOpts = {
            defaultPath: recentDir
        };

        if(dialogType === 'saveFile') {
            dialogOpts.title = `Select directory to store your ${targetName}, and give it a filename.`;
            dialogOpts.buttonLabel = 'OK';
            
            remote.dialog.showSaveDialog(dialogOpts, (file) => {
                if (file) targetInput.value = file;
            });
        } else{
            dialogOpts.properties = [dialogType];

            remote.dialog.showOpenDialog(dialogOpts, (files) => {
                if (files) targetInput.value = files[0];
            });
        }
    }

    // generic browse path btn event
    for (var i = 0; i < genericBrowseButton.length; i++) {
        let targetInputId = genericBrowseButton[i].dataset.targetinput;
        let args = {
            dialogType: genericBrowseButton[i].dataset.selection,
            targetName: genericBrowseButton[i].dataset.fileobj ? genericBrowseButton[i].dataset.fileobj : '',
            targetInput: document.getElementById(targetInputId)
        };
        genericBrowseButton[i].addEventListener('click', handleBrowseButton.bind(this, args));
    }

    // generic dialog closer
    wsutil.liveEvent('.dialog-close-default','click', (event) => {
        let el = event.target;
        if(el.dataset.target){
            let tel = document.querySelector(el.dataset.target);
            tel.close();
        }
    });

    var enterHandler;
    function handleFormEnter(el){
        if(enterHandler) clearTimeout(enterHandler);

        let key = this.event.key;
        enterHandler = setTimeout(()=>{
            if(key === 'Enter'){
                let section = el.closest('.section');
                let target = section.querySelector('button:not(.notabindex)');
                if(target) target.dispatchEvent(new Event('click'));
            }
        },400);
    }

    for(var oi=0;oi<genericEnterableInputs.length;oi++){
        let el = genericEnterableInputs[oi];
        el.addEventListener('keyup', handleFormEnter.bind(this, el));
    }

    let tp = document.querySelectorAll('.togpass');
    for(var xi=0; xi<tp.length; xi++){
        tp[xi].addEventListener('click', function(e){
            let targetId = e.currentTarget.dataset.pf;
            if(!targetId) return;
            let target = document.getElementById(targetId);
            if(!target) return;
            if(target.type === "password"){
                target.type = 'text';
                e.currentTarget.firstChild.dataset.icon = 'eye-slash';
            }else{
                target.type = 'password';
                e.currentTarget.firstChild.dataset.icon = 'eye';
            }
        });
    }

    // allow paste by mouse
    const pasteMenu = Menu.buildFromTemplate([
        { label: 'Paste', role: 'paste'}
    ]);

    for(var ui=0;ui<genericEditableInputs.length;ui++){
        let el = genericEditableInputs[ui];
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            pasteMenu.popup(remote.getCurrentWindow());
        }, false);
    }

    //dmswitch.addEventListener('click', () => {
    //    let tmode = thtml.classList.contains('dark') ? '' : 'dark';
    //    setDarkMode(tmode);
    //});

    kswitch.addEventListener('click', showKeyBindings);
    handleNetworkChange();

    // settings handlers
    handleSettings();

    // addressbook handlers
    handleAddressBook();

    // open wallet
    handleWalletOpen();

    // close wallet
    handleWalletClose();

    // create wallet
    handleWalletCreate();

    // export keys/seed
    handleWalletExport();

    // send transfer
    handleSendTransfer();

    // mining
    handleMiner();

    // import keys
    handleWalletImportKeys();

    // import seed
    handleWalletImportSeed();

    // transactions
    handleTransactions();
}

function initKeyBindings(){
    let walletOpened;
    // switch tab: ctrl+tab
    Mousetrap.bind(['ctrl+tab','command+tab'], switchTab);
    Mousetrap.bind(['ctrl+o','command+o'], () => {
        walletOpened = wsession.get('serviceReady') || false;
        if(walletOpened){
            showToast('Please close current wallet before opening another wallet!');
            return;
        }
        return changeSection('section-overview-load');
    });
    Mousetrap.bind(['ctrl+x','command+x'], () => {
        walletOpened = wsession.get('serviceReady') || false;
        if(!walletOpened){
            showToast('No wallet is currently opened');
            return;
        }
        overviewWalletCloseButton.dispatchEvent(new Event('click'));
    });
    // display/export private keys: ctrl+e
    Mousetrap.bind(['ctrl+e','command+e'],() => {
        walletOpened = wsession.get('serviceReady') || false;
        if(!walletOpened) return;
        return changeSection('section-overview-show');
    });
    // create new wallet: ctrl+n
    Mousetrap.bind(['ctrl+n','command+n'], ()=> {
        walletOpened = wsession.get('serviceReady') || false;
        if(walletOpened){
            showToast('Please close current wallet before creating/importing new wallet');
            return;
        }
        return changeSection('section-overview-create');
    });
    // import from keys: ctrl+i
    Mousetrap.bind(['ctrl+i','command+i'],() => {
        walletOpened = wsession.get('serviceReady') || false;
        if(walletOpened){
            showToast('Please close current wallet before creating/importing new wallet');
            return;
        }
        return changeSection('section-overview-import-key');
    });
    // tx page: ctrl+t
    Mousetrap.bind(['ctrl+t','command+t'],() => {
        walletOpened = wsession.get('serviceReady') || false;
        if(!walletOpened){
            showToast('Please open your wallet to view your transactions');
            return;
        }
        return changeSection('section-transactions');
    });
    // send tx: ctrl+s
    Mousetrap.bind(['ctrl+s','command+s'],() => {
        walletOpened = wsession.get('serviceReady') || false;
        if(!walletOpened){
            showToast('Please open your wallet to make a transfer');
            return;
        }
        return changeSection('section-send');
    });
    // import from mnemonic seed: ctrl+shift+i
    Mousetrap.bind(['ctrl+shift+i','command+shift+i'], () => {
        walletOpened = wsession.get('serviceReady') || false;
        if(walletOpened){
            showToast('Please close current wallet before creating/importing new wallet');
            return;
        }
        return changeSection('section-overview-import-seed');
    });

    // back home
    Mousetrap.bind(['ctrl+home','command+home'], ()=>{
        let section = walletOpened ? 'section-overview' : 'section-welcome';
        return changeSection(section);
    });

    // show key binding
    Mousetrap.bind(['ctrl+/','command+/'], () => {
        let openedDialog = document.querySelector('dialog[open]');
        if(openedDialog) return openedDialog.close();
        return showKeyBindings();
    });

    Mousetrap.bind('esc', () => {
        let openedDialog = document.querySelector('dialog[open]');
        if(!openedDialog) return;
        return openedDialog.close();
    });

    Mousetrap.bind([`ctrl+\\`,`command+\\`], ()=>{
        setDarkMode(!document.documentElement.classList.contains('dark'));
    });
}

// spawn event handlers
document.addEventListener('DOMContentLoaded', () => {
    initHandlers();
    showInitialPage();
    initKeyBindings();
}, false);

ipcRenderer.on('daemoncoreready', (event, flag) => {
  if (flag === 'true') {
    wsmanager.daemonCoreReady = true;
    return;
  }
  wsmanager.daemonCoreReady = false;
});

ipcRenderer.on('console', (event, sChunk) => {
    var el = document.getElementById("terminal");
    consoleUI(el, sChunk, true, "");
});

ipcRenderer.on('checkHeight', () => {
  wsmanager.notifySyncWorker({ type: 'checkHeight', data: {} });
});

ipcRenderer.on('checkBalanceUpdate', () => {
  wsmanager.notifySyncWorker({ type: 'checkBalanceUpdate', data: {} });
});

ipcRenderer.on('checkTransactionsUpdate', () => {
  wsmanager.notifySyncWorker({ type: 'checkTransactionsUpdate', data: {} });
});

ipcRenderer.on('checkBlockUpdate', () => {
  wsmanager.notifySyncWorker({ type: 'checkBlockUpdate', data: {} });
});

ipcRenderer.on('saveWallet', () => {
  wsmanager.notifySyncWorker({ type: 'saveWallet', data: {} });
});

ipcRenderer.on('promptexit', () => {

    if(remote.app.prompShown) return;
    let msg = 'Are you sure, want to exit?';
    remote.app.prompShown = true;
    let reslt = confirm(msg);
    remote.app.prompShown = false;

    if (reslt == true) {
      remote.app.prompExit = false;
    } else {
      return;
    }

    remote.app.emit('exit');

    if (win != null) {
      if(!win.isVisible()) win.show();
      if(win.isMinimized()) win.restore();
      win.focus();
    }

    var dialog = document.getElementById('main-dialog');
    let htmlText = 'Terminating WalletShell...';
    if(wsession.get('loadedWalletAddress') !== ''){
        htmlText = 'Saving &amp; closing your wallet...';
    }

    let htmlStr = `<div class="div-save-main" style="text-align: center;padding:1rem;"><i class="fas fa-spinner fa-pulse"></i><span style="padding:0px 10px;">${htmlText}</span></div>`;
    dialog.innerHTML = htmlStr;
    dialog.showModal();

    wsmanager.stopSyncWorker();
    wsmanager.stopService().then(() => {
        setTimeout(function(){
            dialog.innerHTML = 'Good bye!';
            wsmanager.terminateService(true);
            if (win != null) win.close();
        }, 1200);
    }).catch((err) => {
        wsmanager.terminateService(true);
        console.log(err);
        if (win != null) win.close();
    });
});
