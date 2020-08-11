"use strict";
const path = require('path');
const remote = require('electron').remote;
const Store = require('electron-store');
const settings = new Store({name: 'Settings'});

const DEFAULT_TITLE = 'FedoraGold (FED) Wallet';
const SESSION_KEY = 'fedwlshell';

// TODO: this is the only thing left as global
const IS_DEBUG = remote.getGlobal('wsession').debug;
const WALLET_CFG = path.join(remote.app.getPath('userData'), 'wconfig.txt');
const MINER_CFG = path.join(remote.app.getPath('userData'), 'minerconfig.txt');
const POOL_CFG = path.join(remote.app.getPath('userData'), 'poolconfig.txt');
const AMD_CFG = path.join(remote.app.getPath('userData'), 'amdconfig.txt');
const NVIDIA_CFG = path.join(remote.app.getPath('userData'), 'nvidiaconfig.txt');
const CPU_CFG = path.join(remote.app.getPath('userData'), 'cpuconfig.txt');

var WalletShellSession = function(){
    if (!(this instanceof WalletShellSession)) return new WalletShellSession();

    this.sessKey = SESSION_KEY;
    this.eventName = 'sessionUpdated';
    this.sessDefault = {
        loadedWalletAddress: '',
        walletHash: '',
        walletUnlockedBalance: 0,
        walletLockedBalance: 0,
        walletConfig: WALLET_CFG,
        minerConfig: MINER_CFG,
        amdConfig: AMD_CFG,
        nvidiaConfig: NVIDIA_CFG,
        cpuConfig: CPU_CFG,
        poolConfig: POOL_CFG,
        synchronized: false,
        syncStarted: false,
        serviceReady: false,
        connectedNode: '',
        txNew: [],
        txLen: 0,
        txLastHash: null,
        txLastTimestamp: null,
        nodeFee: 0,
        nodeChoices: settings.get('pubnodes_data', []),
        servicePath: settings.get('service_bin', 'fedoragold_walletd'),
        configUpdated: false,
        uiStateChanged: false,
        defaultTitle: DEFAULT_TITLE,
        debug: IS_DEBUG 
    };

    // initialize
    if(!sessionStorage.getItem(this.sessKey)){
        sessionStorage.setItem(this.sessKey, JSON.stringify(this.sessDefault));
    }
};

WalletShellSession.prototype.get = function(key){
    key = key || false;
    if(!key){
        return JSON.parse(sessionStorage.getItem(this.sessKey)) || this.sessDefault;
    }
    
    if(!Object.prototype.hasOwnProperty.call(this.sessDefault, key)){
        throw new Error(`Invalid session key: ${key}`);
    }

    return JSON.parse(sessionStorage.getItem(this.sessKey))[key];
};

WalletShellSession.prototype.getDefault = function(key){
    if(!key){
        return this.sessDefault;
    }
    return this.sessDefault[key];
};

WalletShellSession.prototype.set = function(key, val){
    if(!Object.prototype.hasOwnProperty.call(this.sessDefault, key)){
        throw new Error(`Invalid session key: ${key}`);
    }

    let sessData = this.get(); // all current data obj
    sessData[key] = val; // update value
    return sessionStorage.setItem(this.sessKey, JSON.stringify(sessData));
};

WalletShellSession.prototype.reset = function(key){
    if(key){
        if(!Object.prototype.hasOwnProperty.call(this.sessDefault, key)){
            throw new Error('Invalid session key');
        }
        let sessData = this.get(); // all current data obj
        sessData[key] = this.sessDefault[key]; // set to default value
        return sessionStorage.setItem(this.sessKey, JSON.stringify(sessData[key]));
    }
    return sessionStorage.setItem(this.sessKey, JSON.stringify(this.sessDefault));
};

WalletShellSession.prototype.destroy = function(){
    return sessionStorage.removeItem(this.sessKey);
};

module.exports = WalletShellSession;
