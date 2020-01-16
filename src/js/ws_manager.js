/* eslint no-empty: 0 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const log = require('electron-log');
const Store = require('electron-store');
const WalletShellSession = require('./ws_session');
const WalletShellApi = require('./ws_api');
const uiupdater = require('./wsui_updater');
const wsutil = require('./ws_utils');
const config = require('./ws_config');
const remote = require('electron').remote;

const settings = new Store({name: 'Settings'});
const wsession = new WalletShellSession();

const SERVICE_LOG_DEBUG = wsession.get('debug');
const SERVICE_LOG_LEVEL_DEFAULT = 0;
const SERVICE_LOG_LEVEL_DEBUG = 4;
const SERVICE_LOG_LEVEL = (SERVICE_LOG_DEBUG ? SERVICE_LOG_LEVEL_DEBUG : SERVICE_LOG_LEVEL_DEFAULT);
const ERROR_WALLET_EXEC = `Failed to start ${config.walletServiceBinaryFilename}.`;
const ERROR_WALLET_PASSWORD = 'Failed to load your wallet, failed password, or issue with daemon - see Settings Daemon Console...';
const ERROR_WALLET_IMPORT = 'Import failed, please check that you have entered all information correctly';
const ERROR_WALLET_CREATE = 'Wallet can not be created, please check your input and try again';

const INFO_FUSION_DONE = 'Wallet optimization completed, your balance may appear incorrect for a while.';
const INFO_FUSION_SKIPPED = 'Wallet already optimized. No further optimization is needed.';
const ERROR_FUSION_FAILED = 'Unable to optimize your wallet, please try again in a few seconds';

let SVC_BIN = '';
let plat = process.platform;
let daemonCoreReady = false;

var bRemoteDaemon = true;

// make sure nodejs allocates enough threads for sending and receiving transactions
process.env.UV_THREADPOOL_SIZE = 128;

const SVC_FILENAME =  (plat === 'win32' ? `${config.walletServiceBinaryFilename}.exe` : config.walletServiceBinaryFilename );
const SVC_OSDIR = (plat === 'win32' ? 'win' : (plat === 'darwin' ? 'mac' : 'linux'));
const DEFAULT_SVC_BIN = path.join(process.resourcesPath,'bin', SVC_OSDIR, SVC_FILENAME);
if (plat === 'darwin') {
  SVC_BIN = DEFAULT_SVC_BIN;
}
else {
  SVC_BIN = settings.get('service_bin');
}

var WalletShellManager = function(){
    if (!(this instanceof WalletShellManager)){
        return new WalletShellManager();
    }

    this.daemonHost = settings.get('daemon_host');
    this.daemonPort = settings.get('daemon_port');
    this.serviceProcess = null;
    this.serviceBin = SVC_BIN;
    this.walletdPassword = settings.get('walletd_password');
    this.walletdHost = settings.get('walletd_host');
    this.walletdPort = settings.get('walletd_port');
    this.serviceArgsDefault = [];
    this.walletConfigDefault = {'rpc-password': settings.get('walletd_password')};
    this.servicePid = null;
    this.serviceLastPid = null;
    this.serviceActiveArgs = [];
    this.serviceApi =  null;
    this.syncWorker = null;
    this.fusionTxHash = [];
};

const getHttpContent = function(url) {
  // return new pending promise
  return new Promise((resolve, reject) => {
    // select http or https module, depending on reqested url
    const lib = url.startsWith('https') ? require('https') : require('http');
    const request = lib.get(url, (response) => {
      // handle http errors
      if (response.statusCode < 200 || response.statusCode > 299) {
         reject(new Error('Failed to load page, status code: ' + response.statusCode));
       }
      // temporary data holder
      const body = [];
      // on every content chunk, push it to the data array
      response.on('data', (chunk) => body.push(chunk));
      // we are done, resolve promise with those joined chunks
      response.on('end', () => resolve(body.join('')));
    });
    // handle connection errors of the request
    request.on('error', (err) => reject(err))
    })
};

var heightVal=0;
WalletShellManager.prototype.init = function(password){
  this._getSettings();
  if(this.serviceApi !== null) return;

  let cfg = {
   daemon_host: this.daemonHost,
   daemon_port: this.daemonPort,
   walletd_host: this.walletdHost,
   walletd_port: this.walletdPort,
   walletd_password: password,
   daemonCoreReady: this.daemonCoreReady
  };

  this.serviceApi = new WalletShellApi(cfg);
  this.serviceApi.setPassword(password);

  // One very quick check of local daemaon height specifically for login processing
  //getHttpContent("http://127.0.0.1:" + this.daemonPort + "/getheight")
  //  .then((html) => heightVal = html.match(/(?<=:\s*).*?(?=\s*,)/gs))
  //  .catch((err) => heightVal = 0);

  this.serviceApi.getHeight().then((result) => {
    heightVal = parseInt(result.height, 10);
  }).catch((err) => {
    //just eat this... sometimes daemon takes a while to start...
    //log.warn(`getHeight from Daemon: FAILED, ${err.message}`);
  });
};

WalletShellManager.prototype._getSettings = function(){
    this.daemonHost = settings.get('daemon_host');
    this.daemonPort = settings.get('daemon_port');
};

WalletShellManager.prototype._reinitSession = function(){
    wsession.reset();
    // remove wallet config
    let configFile = wsession.get('walletConfig');
    //log.warn("configFile is: "+configFile);
    if(configFile) try{ fs.unlinkSync(configFile); }catch(e){}
    this.notifyUpdate({
        type: 'sectionChanged',
        data: 'reset-oy'
    });
};

WalletShellManager.prototype.serviceStatus = function(){
    return  (undefined !== this.serviceProcess && null !== this.serviceProcess);
};

WalletShellManager.prototype.isRunning = function () {
    let proc = path.basename(this.serviceBin);
    let platform = process.platform;
    let cmd = '';
    switch (platform) {
        case 'win32' : cmd = `tasklist`; break;
        case 'darwin' : cmd = `ps -ax | grep ${proc}`; break;
        case 'linux' : cmd = `ps -A`; break;
        default: break;
    }
    if(cmd === '' || proc === '') return false;

    childProcess.exec(cmd, (err, stdout, stderr) => {
        if(err) log.debug(err.message);
        if(stderr) log.debug(stderr.toLocaleLowerCase());
        let found = stdout.toLowerCase().indexOf(proc.toLowerCase()) > -1;
        log.debug(`Process found: ${found}`);
        return found;
    });
};

WalletShellManager.prototype._writeIniConfig = function(cfg){
    let configFile = wsession.get('walletConfig');
    if(!configFile) return '';

    try{
        fs.writeFileSync(configFile, cfg);
        return configFile;
    }catch(err){
        log.error(err);
        return '';
    }
};

WalletShellManager.prototype._writeConfig = function(cfg){
    let configFile = wsession.get('walletConfig');
    if(!configFile) return '';

    cfg = cfg || {};
    if(!cfg) return '';

    let configData = '';
    Object.keys(cfg).map((k) => { configData += `${k}=${cfg[k]}${os.EOL}`;});
    try{
        fs.writeFileSync(configFile, configData);
        return configFile;
    }catch(err){
        log.error(err);
        return '';
    }
};

WalletShellManager.prototype.startService = function(walletFile, password, onError, onSuccess, onDelay){
    this.init(password);

    if(null !== this.serviceLastPid){
        // try to kill last process, in case it was stalled
        log.debug(`Trying to clean up old/stalled process, target pid: ${this.serviceLastPid}`);
        try{
            process.kill(this.serviceLastPid, 'SIGKILL');
        }catch(e){}
    }

    if(this.syncWorker) this.stopSyncWorker();

    // SERVICE_LOG_LEVEL,
    let serviceArgs = this.serviceArgsDefault.concat([
        '--container-file', walletFile,
        '--container-password', password,
        '--rpc-user', 'fedadmin',
        '--rpc-password', password,
        '--log-level', 0,
        '--address',
    ]);

    let wsm = this;
    childProcess.execFile(this.serviceBin, serviceArgs, {timeout:5000}, (error, stdout, stderr) => {
            if(stderr) log.error(stderr);

            let addressLabel = "Address: "; 
            if(stdout && stdout.length && stdout.indexOf(addressLabel) !== -1){
                let trimmed = stdout.trim();
                let walletAddress = trimmed.substring(trimmed.indexOf(addressLabel)+
                  addressLabel.length, trimmed.length);
                wsession.set('loadedWalletAddress', walletAddress);

                //log.warn("wallet address loaded: "+walletAddress);

                // allow heightVal to get set properly first (mostly) - happens asynchronously
                setTimeout(() => {
                  // the first call just got the address back... now we run it for reals
                  wsm._spawnService(walletFile, password, onError, onSuccess, onDelay);
                }, 5000, wsm, walletFile, password, onError, onSuccess, onDelay);
            }else{
                // just stop here
                onError(ERROR_WALLET_PASSWORD+" "+stderr);
            }
        }
    );
};

WalletShellManager.prototype._argsToIni = function(args) {
    let configData = "";
    if("object" !== typeof args || !args.length) return configData;
    args.forEach((k,v) => {
        let sep = ((v%2) === 0) ? os.EOL : "=";
        configData += `${sep}${k.toString().replace('--','')}`;
    });
    return configData.trim();
};

function logFile(walletFile) {
    let file = path.basename(walletFile);
    return path.join( path.dirname(walletFile), `${file.split(' ').join('').split('.')[0]}.log`);
}

WalletShellManager.prototype._spawnService = function(walletFile, password, onError, onSuccess, onDelay) {

    if (this.serviceProcess != null) {
      // don't allow it to be spawned twice...
      return;
    }

    // Calculates network top block at time wallet is start.  It's is okay
    //  if this value is overwritten later to the local top_block height
    var tblock = 0;
    var topb = settings.get('top_block');
    if (topb === undefined) topb=0;
    if (remote.app.primarySeedHeight > 0 && remote.app.primarySeedHeight > topb) {
      tblock = remote.app.primarySeedHeight;
      settings.set('top_block', tblock);
    } else {
      tblock = topb;
    }

    var cblock = settings.get('current_block');
    if (cblock === undefined) cblock=0;

    var priority = remote.app.primarySeedAddr;
    var secondary = remote.app.secondarySeedAddr;
    var daemonAd = priority;
    var daemonPt = 30159;
    var priNode = priority+":30158";
    var secNode = secondary+":30158";

    // Determines if the local daemon is almost current (about 3 days'ish current)
    if ((cblock > 0) && (tblock > 0) && ((6000+cblock) > tblock)) {
      // This detects if the local daemon was forced into a full resync or rescan also...
      if (6000+heightVal > tblock) {
        daemonAd = '127.0.0.1';
        daemonPt = settings.get('daemon_port');
        bRemoteDaemon = false;
      }
    }

    log.warn("heightVal: "+heightVal);
    log.warn("current block: "+cblock);
    log.warn("block height: "+tblock);
    log.warn("priNode: "+priNode);
    log.warn("secNode: "+secNode);
    log.warn("daemon address: "+daemonAd);
    log.warn("daemon port: "+daemonPt);

    this.serviceApi.setPassword(password);

    // --daemon,
    // --allow-local-ip,
    let serviceArgs=[];
    if (remote.app.integratedDaemon) {
      serviceArgs = [
        '--data-dir', remote.app.getPath('userData'),
        '--container-file', walletFile,
        '--container-password', password,
        '--bind-address', '127.0.0.1',
        '--bind-port', this.walletdPort,
        '--rpc-user', 'fedadmin',
        '--rpc-password', password,
        '--add-priority-node', priNode,
        '--add-priority-node', secNode,
        '--log-level', 0,
        '--local',
      ];

      log.warn("integrated daemon mode");
    }
    else {
      serviceArgs = [
        '--data-dir', remote.app.getPath('userData'),
        '--container-file', walletFile,
        '--container-password', password,
        '--bind-address', '127.0.0.1',
        '--bind-port', this.walletdPort,
        '--rpc-user', 'fedadmin',
        '--rpc-password', password,
        '--add-priority-node', priNode,
        '--add-priority-node', secNode,
        '--log-level', 0,
        '--daemon-address', daemonAd, 
        '--daemon-port', daemonPt
      ];
    }

    //log.warn("serviceArgs: "+serviceArgs);
    let wsm = this;

    try{
        this.serviceProcess = childProcess.spawn(wsm.serviceBin, serviceArgs,
          {detached: false, stdio: ['ignore','pipe','pipe'], encoding: 'utf-8'});
        this.servicePid = this.serviceProcess.pid;

    } catch(e) {
        if (onError) onError(ERROR_WALLET_EXEC);
        log.error(`${config.walletServiceBinaryFilename} is not running`);
        return false;
    }
    
    this.serviceProcess.on('close', () => {
        wsm.terminateService(true);
        log.debug(`${config.walletServiceBinaryFilename} closed`);
        wsm.serviceProcess = null;
    });

    this.serviceProcess.on('error', (err) => {
        wsm.terminateService(true);
        wsm.syncWorker.stopSyncWorker();
        log.warn(`${config.walletServiceBinaryFilename} error: ${err.message}`);
    });

    if(!this.serviceStatus()){
        if(onError) onError(ERROR_WALLET_EXEC);
        log.error(`${config.walletServiceBinaryFilename} is not running`);
        return false;
    }

    setTimeout(function() {
      wsm.serviceActiveArgs = serviceArgs;
      wsession.set('connectedNode', `${settings.get('daemon_host')}:${settings.get('daemon_port')}`);

      wsm.startSyncWorker(password, daemonAd, daemonPt);

      var addr = wsession.get('loadedWalletAddress');
      setTimeout(function() {
        wsm.notifyUpdate({
          type: 'addressUpdated',
          data: addr
        });
      }, 125, wsm, addr);

      onSuccess();
    }, 3000, wsm, serviceArgs, password);
};

WalletShellManager.prototype.stopService = function(){
    let wsm = this;
    return new Promise(function (resolve){
        if(wsm.serviceStatus()){
            wsm.serviceLastPid = wsm.serviceProcess.pid;
            wsm.stopSyncWorker();
            wsm.serviceApi.save().then(() =>{
                try{
                    wsm.terminateService(true);
                    wsm._reinitSession();
                    resolve(true);
                }catch(err){
                    log.warn(`SIGTERM failed: ${err.message}`);
                    wsm.terminateService(true);
                    wsm._reinitSession();
                    resolve(false);
                }
            }).catch((err) => {
                //log.warn(`Failed to save wallet: ${err.message}`);
                // try to wait for save to completed before force killing
                setTimeout(()=>{
                    wsm.terminateService(true); // force kill
                    wsm._reinitSession();
                    resolve(true);
                },10000);
            });
        } else {
            wsm._reinitSession();
            resolve(false);
        }
    });
};

WalletShellManager.prototype.terminateService = function(force) {
    if(!this.serviceStatus()) return;
    force = force || false;
    let signal = force ? 'SIGKILL' : 'SIGTERM';
    //log.debug(`terminating with ${signal}`);
    this.serviceLastPid = this.servicePid;
    try{
        this.serviceProcess.kill(signal);
        if(this.servicePid) process.kill(this.servicePid, signal);
    }catch(e){
        if(!force && this.serviceProcess) {
            log.debug(`SIGKILLing ${config.walletServiceBinaryFilename}`);
            try{this.serviceProcess.kill('SIGKILL');}catch(err){}
            if(this.servicePid){
                try{process.kill(this.servicePid, 'SIGKILL');}catch(err){}
            }
        }
    }
    
    this.serviceProcess = null;
    this.servicePid = null;
};

WalletShellManager.prototype.startSyncWorker = function(password, daemonAd, daemonPt) {

    if (this.syncWorker !== null) {
      log.warn("syncWorker is already running... restarting it.");
      try{this.syncWorker.kill('SIGKILL');}catch(e){}
      this.syncWorker = null;
    }

    let wsm = this;
    wsm.syncWorker = childProcess.fork(path.join(__dirname,'./ws_syncworker.js'));

    wsm.syncWorker.on('message', function(msg) {
      wsm.notifyUpdate(msg);
    });

    wsm.syncWorker.on('close', function() {
        wsm.syncWorker = null;
        try{wsm.syncWorker.kill('SIGKILL');}catch(e){}
        log.debug(`service worker terminated.`);
    });

    wsm.syncWorker.on('exit', function (){
        wsm.syncWorker = null;
        log.debug(`service worker exited.`);
    });

    wsm.syncWorker.on('error', function(err){
        try{wsm.syncWorker.kill('SIGKILL');}catch(e){}
        wsm.syncWorker = null;
        log.debug(`service worker error: ${err.message}`);
    });

    let cfgData = {
      type: 'start',
      data: {
        daemon_host: daemonAd,
        daemon_port: daemonPt,
        walletd_host: wsm.walletdHost,
        walletd_port: wsm.walletdPort,
        walletd_password: password,
        remote_daemon: bRemoteDaemon
      }
    };
    wsm.syncWorker.send(cfgData);
    wsession.set('serviceReady', true);
    wsession.set('syncStarted', true);
};

WalletShellManager.prototype.stopSyncWorker = function(){
    if(null === this.syncWorker) return;

    try{
        this.syncWorker.send({type: 'stop', data: {}});
        this.syncWorker.kill('SIGTERM');
        this.syncWorker  = null;
    }catch(e){
        log.debug(`syncworker already stopped`);
    }
};

WalletShellManager.prototype.getNodeFee = function(){
    let wsm = this;
    
    this.serviceApi.getFeeInfo().then((res) => {
        let theFee;
        if(!res.amount || !res.address){
            theFee = 0;
        }else{
            theFee = (res.amount / config.decimalDivisor);
        }
        wsession.set('nodeFee', theFee);
        if(theFee <= 0) return theFee;
        
        wsm.notifyUpdate({
            type: 'nodeFeeUpdated',
            data: theFee
        });
        return theFee;
    }).catch((err) => {
        log.debug(`failed to get node fee: ${err.message}`);
        return 0;
    });
};

//jojapoppa, didn't know default max length to give integratedaddresses, this shows what it is...
WalletShellManager.prototype.genIntegratedAddress = function(paymentId, address){
    let wsm = this;
    return new Promise((resolve, reject) => {
        address = address || wsession.get('loadedWalletAddress');
        let params = {address: address, paymentId: paymentId};
        wsm.serviceApi.createIntegratedAddress(params).then((result) =>{
            return resolve(result);
        }).catch((err)=>{
            return reject(err);
        });
    });
};

WalletShellManager.prototype.createWallet = function(walletFile, password){
    let wsm = this;
    let walletLog = `.${walletFile}.log`;
    return new Promise((resolve, reject) => {
        let serviceArgs = wsm.serviceArgsDefault.concat(
            ['--container-file', walletFile, '--container-password', password, '--log-level', SERVICE_LOG_LEVEL, '--generate-container']
        );

        if(SERVICE_LOG_LEVEL > 0) {
           serviceArgs.push('--log-file');
           serviceArgs.push(logFile(walletFile));
        }

        //confirm(wsm.serviceBin);
        //confirm(serviceArgs);

        childProcess.execFile(
            wsm.serviceBin, serviceArgs, {timeout:5000}, (error, stdout, stderr) => {
                if(stdout) log.debug(stdout);
                if(stderr) log.error(stderr);
                if (error){
                    log.error(`Failed to create wallet: ${error.message}`);
                    return reject(new Error(error.message));
                    //return reject(new Error(ERROR_WALLET_CREATE));
                } else {
                    if(!wsutil.isRegularFileAndWritable(walletFile)){
                        let errMsg = `${walletFile} is invalid or unreadable`;
                        log.error(errMsg);
                        return reject(new Error(errMsg));
                    }
                    return resolve(walletFile);
                }
            }
        );
    });
};

WalletShellManager.prototype.importFromKeys = function(walletFile, password, viewKey, spendKey, scanHeight){
    let wsm = this;
    return new Promise((resolve, reject) => {
        scanHeight = scanHeight || 0;

	// jojapoppa - keys params not supported... what is this feature?
        let serviceArgs = wsm.serviceArgsDefault.concat([
            '--container-file', walletFile, 
            '--container-password', password,
            '--rpc-user', 'fedadmin',
            '--rpc-password', password,
            '--view-key', viewKey, 
            '--spend-key', spendKey,
            '-g'
        ]);

        if(scanHeight > 1024) serviceArgs = serviceArgs.concat(['--scan-height',scanHeight]);

        childProcess.execFile(
            wsm.serviceBin, serviceArgs, (error, stdout, stderr) => {
                if(stdout) log.debug(stdout);
                if(stderr) log.error(stderr);
                if (error){
                    log.debug(`Failed to import key: ${error.message}`);
                    return reject(new Error(ERROR_WALLET_IMPORT));
                } else {
                    if(!wsutil.isRegularFileAndWritable(walletFile)){
                        return reject(new Error(ERROR_WALLET_IMPORT));
                    }
                    return resolve(walletFile);
                }
            }
        );

    });
};

WalletShellManager.prototype.importFromSeed = function(walletFile, password, mnemonicSeed, scanHeight){
    let wsm = this;
    return new Promise((resolve, reject) => {
        scanHeight = scanHeight || 0;

	// jojapoppa - this is not supported i think... check.  "seed" means
	// loads wallet from blockchain (no local storage) - very risky feature
	// ... i'm not sure i like it.  even if we did this the webpage it
	// loads from would need to be distributed somehow... dunno about this...
	// for now, this nmematic seed web wallet feature is commented out
        let serviceArgs = wsm.serviceArgsDefault.concat([
            '--container-file', walletFile, 
            '--container-password', password,
            '--mnemonic-seed', mnemonicSeed,
            '--rpc-user', 'fedadmin',
            '--rpc-password', password,
            '-g'
        ]);

        if(scanHeight > 1024) serviceArgs = serviceArgs.concat(['--scan-height',scanHeight]);

        childProcess.execFile(
            wsm.serviceBin, serviceArgs, (error, stdout, stderr) => {
                if(stdout) log.debug(stdout);
                if(stderr) log.error(stderr);

                if (error){
                    log.debug(`Error importing seed: ${error.message}`);
                    return reject(new Error(ERROR_WALLET_IMPORT));
                } else {
                    if(!wsutil.isRegularFileAndWritable(walletFile)){
                        return reject(new Error(ERROR_WALLET_IMPORT));
                    }
                    return resolve(walletFile);
                }
            }
        );
    });
};

WalletShellManager.prototype.getSecretKeys = function(address){
    let wsm = this;
    return new Promise((resolve, reject) => {
        wsm.serviceApi.getBackupKeys({address: address}).then((result) => {
            return resolve(result);
        }).catch((err) => {
            log.debug(`Failed to get keys: ${err.message}`);
            return reject(err);
        });
    });
};

WalletShellManager.prototype.sendTransaction = function(params){
    let wsm = this;
    return new Promise((resolve, reject) => {
        wsm.serviceApi.sendTransaction(params).then((result) => {
            return resolve(result);
        }).catch((err) => {
            return reject(err);
        });
    });
};

WalletShellManager.prototype.reset = function(){
    let wsm = this;
    let params = {};
    //log.warn("WalletShellManager: reset");
    wsm.syncWorker.send({ type: 'reset', data: {} });
};

WalletShellManager.prototype._fusionGetMinThreshold = function(threshold, minThreshold, maxFusionReadyCount, counter){
    let wsm = this;
    return new Promise((resolve, reject) => {
        counter = counter || 0;
        threshold = threshold || (parseInt(wsession.get('walletUnlockedBalance'),10)*100)+1;
        threshold = parseInt(threshold,10);
        minThreshold = minThreshold || threshold;
        maxFusionReadyCount = maxFusionReadyCount || 0;
        
        let maxThreshCheckIter = 20;

        wsm.serviceApi.estimateFusion({threshold: threshold}).then((res)=>{
            // nothing to optimize
            if( counter === 0 && res.fusionReadyCount === 0) return resolve(0); 
            // stop at maxThreshCheckIter or when threshold too low
            if( counter > maxThreshCheckIter || threshold < 10) return resolve(minThreshold);
            // we got a possibly best minThreshold
            if(res.fusionReadyCount < maxFusionReadyCount){
                return resolve(minThreshold);
            }
            // continue to find next best minThreshold
            maxFusionReadyCount = res.fusionReadyCount;
            minThreshold = threshold;
            threshold /= 2;
            counter += 1;
            resolve(wsm._fusionGetMinThreshold(threshold, minThreshold, maxFusionReadyCount, counter).then((res)=>{
                return res;
            }));
        }).catch((err)=>{
            return reject(new Error(err));
        });
    });
};

WalletShellManager.prototype._fusionSendTx = function(threshold, counter){
    let wsm = this;
    return new Promise((resolve, reject) => {
        counter = counter || 0;
        let maxIter = 256;
        if(counter >= maxIter) return resolve(wsm.fusionTxHash); // stop at max iter
        
        // keep sending fusion tx till it hit IOOR or reaching max iter 
        log.debug(`send fusion tx, iteration: ${counter}`);
        wsm.serviceApi.sendFusionTransaction({threshold: threshold}).then((resp)=> {
            wsm.fusionTxHash.push(resp.transactionHash);
            counter +=1;
            return resolve(wsm._fusionSendTx(threshold, counter).then((resp)=>{
                return resp;
            }));
        }).catch((err)=>{
            return reject(new Error(err));
        });
    });
};

WalletShellManager.prototype.optimizeWallet = function(){
    let wsm = this;
    return new Promise( (resolve, reject) => {
        wsm.fusionTxHash = [];
        wsm._fusionGetMinThreshold().then((res)=>{
            if(res <= 0 ){
                wsm.notifyUpdate({
                    type: 'fusionTxCompleted',
                    data: INFO_FUSION_SKIPPED
                });
                return resolve(INFO_FUSION_SKIPPED);
            }

            log.debug(`performing fusion tx, threshold: ${res}`);
            return resolve(
                wsm._fusionSendTx(res).then(() => {
                    wsm.notifyUpdate({
                        type: 'fusionTxCompleted',
                        data: INFO_FUSION_DONE
                    });
                    return INFO_FUSION_DONE;
                }).catch((err)=>{
                    let msg = err.message.toLowerCase();
                    let outMsg = ERROR_FUSION_FAILED;
                    switch(msg){
                        case 'index is out of range':
                            outMsg = wsm.fusionTxHash.length >=1 ? INFO_FUSION_DONE : INFO_FUSION_SKIPPED;
                            break;
                        default:
                            break;
                    }
                    wsm.notifyUpdate({
                        type: 'fusionTxCompleted',
                        data: outMsg
                    });
                    return outMsg;
                })
            );
        }).catch((err)=>{
            return reject((err.message));
        });
    });
};

//jojapoppa: this can be repurposed to allow the dynamic assignment of daemon's.  that way
// if a remote daemon goes down it can retarget, or switch from remote to local on the fly etc...
//
//WalletShellManager.prototype.networkStateUpdate = function(state){
//  if(!this.syncWorker) return;    
//  log.warn('networkStateUpdate ServiceProcess PID: ' + this.servicePid);
//
//  if(state === 0){
//    // pause the syncworker, but leave service running
//    this.syncWorker.send({
//      type: 'pause',
//      data: null
//    });
//  }else{
//      // looks like fedoragold_walletd always stalled after disconnected, just kill & relaunch it
//      let pid = null;
//      if (this.serviceProcess != null) {
//        pid = this.serviceProcess.pid || null;
//      }
//
//      this.terminateService();
//
//      // wait a bit
//      setImmediate(() => {
//        if (pid){
//          try{process.kill(pid, 'SIGKILL');}catch(e){}
//        }
//          setTimeout(()=>{
//          log.warn(`respawning ${config.walletServiceBinaryFilename} after network outage...`);
//          this.serviceProcess = childProcess.spawn(this.serviceBin, this.serviceActiveArgs);
//          // store new pid
//          this.servicePid = this.serviceProcess.pid;
//          this.syncWorker.send({
//            type: 'resume',
//            data: null
//          });
//        },15000);
//      },2500);        
//  }
//};

WalletShellManager.prototype.notifyUpdate = function(msg){
//    log.warn(`in notifyUpdate ... calling updateUiState: ${msg.type}`);
    uiupdater.updateUiState(msg);
};

WalletShellManager.prototype.notifySyncWorker = function(msg){
    if (this.syncWorker != null) {
      this.syncWorker.send(msg);
    }
};

WalletShellManager.prototype.resetState = function(){
    return this._reinitSession();
};

module.exports = WalletShellManager;
