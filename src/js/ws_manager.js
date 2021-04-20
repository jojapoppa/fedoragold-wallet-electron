/* eslint no-empty: 0 */
"use strict";

let DEBUG=true;

const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const childProcess = require('child_process');
const exec = require('child_process').exec;
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
const ERROR_WALLET_PASSWORD = 'Failed to load your wallet, failed password, or daemon synching - see Settings Daemon Console...';
const ERROR_WALLET_IMPORT = 'Import failed, please check that you have entered all information correctly';
const ERROR_WALLET_CREATE = 'Wallet can not be created, please check your input and try again';

const INFO_FUSION_DONE = 'Wallet optimization completed, your balance may appear incorrect for a while.';
const INFO_FUSION_SKIPPED = 'Wallet optimized. No further optimization is needed.';
const ERROR_FUSION_FAILED = 'Unable to optimize your wallet, please try again in a few seconds';

let DEBUG=true;

var bRemoteDaemon = true;
this.stdBuf = '';
this.chunkBufr = '';
this.hyperBuf = '';
this.hyperPid = 0;
this.minerPid = 0;
this.hyperProcess = null;
this.minerProcess = null;
this.walletProcess = null;

let SVC_BIN = '';
let plat = process.platform;
let daemonCoreReady = false;
let daemonHeight = 0;

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

    this.cjdnsadminPort = settings.get('cjdnsadmin_port');
    this.cjdnsudpPort = settings.get('cjdnsudp_port');
    this.cjdnsbeaconPort = settings.get('cjdnsbeacon_port');

    this.serviceArgsDefault = [];
    this.walletConfigDefault = {'rpc-password': settings.get('walletd_password')};
    this.servicePid = null;
    this.serviceLastPid = null;
    this.serviceActiveArgs = [];
    this.serviceApi =  null;
    this.syncWorker = null;
    this.fusionTxHash = [];
};

WalletShellManager.prototype.killMiner = function(apid) {
  if (apid == 0) {
    apid = this.minerPid;
  }

  //log.warn("killMiner()... at pid: "+apid);
  if (this.minerPid == 0) {
    return;
  }

  let signal = 'SIGKILL';
  try {
    this.minerProcess.kill(signal);
    if (apid) this.process.kill(apid, signal);
  } catch(e) {
    // Just try again and bail out...
    try{process.kill(apid, 'SIGKILL');}catch(err){}
  }

  this.minerProcess = null;
  this.minerPid = 0;
}

const getHtpContent = function(host, path, cookie) {
  // select http or https module, depending on reqested url
  const httplib = host.startsWith('https') ? require('https') : require('http');

  var options = { 
    hostname: host,
    path: path,
    method: 'GET',
    headers: {'Cookie': cookie}
  };

  log.warn("Requesting URL: "+host+" path: "+path+" cookie: "+cookie);
  const request = httplib.get(options, (response) => {
    response.setEncoding('utf8');

    // handle http errors
    if (response.statusCode < 200 || response.statusCode > 299) {
      log.warn('Failed to load page, status code: ' + response.statusCode);
    }

    const body = [];
    response.on('data', (chunk) => {
      let schunk = chunk.toString();
      body.push(schunk);
      // we are done, resolve promise with those joined chunks
      log.warn("chunk: "+schunk);
    });

    response.on('end', () => {
      var pagetext = body.join('');
      log.warn("server responded..."+pagetext);
    });
  });

  request.on('error', function(e) {
    log.warn('problem with request: ' + e.message);
  });
};

WalletShellManager.prototype.getSockPath = function() {
  //log.warn("in getSockPath");
  let socketdatapath = path.join(remote.app.getPath('userData'), 'cjdns_sock');
  let mplat = this.getPlatform();
  let OSID = (mplat === 'win32' ? 'win' : (mplat === 'darwin' ? 'mac' : 'linux'));
  let cjdSocketPath = socketdatapath;
  if (OSID === 'win') {
    socketdatapath = 'wincjdns.sock';
    //cjdSocketPath = socketdatapath; //socketdatapath.replace("wincjdns.sock", "\\\\.\\pipe\\cjdns_sock");
    cjdSocketPath = "\\\\.\\pipe\\cjdns_sock"; 
  }
  return cjdSocketPath;
}

WalletShellManager.prototype.init = function(password){
  this._getSettings();
  //if(this.serviceApi !== null) return; this messes you up when opening a new wallet

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
  daemonHeight = remote.app.heightVal;

  if (remote.app.heightVal <=0) {
    this.serviceApi.getHeight().then((result) => {
      daemonHeight = result.height; //parseInt(result.height, 10);
    }).catch((err) => {
      //just eat this... sometimes daemon takes a while to start...
      //log.warn(`getHeight from Daemon: FAILED, ${err.message}`);
    });
  }

  log.warn("daemonHeight initialized to: "+daemonHeight);
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

function splitLines(t) { return t.split(/\r\n|\r|\n/); }
WalletShellManager.prototype.getMinerPID = function () {
  var cmd = `ps -ex`;
  switch (process.platform) {
    case 'win32' : cmd = `tasklist`; break;
    case 'darwin' : cmd = `ps -ax`; break;
    case 'linux' : cmd = `ps -A`; break;
    default: break;
  }

  // the x: 0 is a workaround for the ENOMEM bug in nodejs: https://github.com/nodejs/node/issues/29008
  var status = false;
  exec(cmd, {
    maxBuffer: 2000 * 1024,
    env: {x: 0}
  }, function(error, stdout, stderr) {
    var procStr = stdout.toLowerCase();
    if (procStr.indexOf('xmr-stak') > -1) {

      var dloc = procStr.indexOf('xmr-stak');
      procStr = procStr.substring(0, dloc);
      var procAry = splitLines(procStr);
      procStr = procAry[procAry.length-1];
      procStr = procStr.trim();

      let pid = parseInt(procStr.substr(0, procStr.indexOf(' ')), 10);
      //log.warn("xmr-stak process already running at process ID: "+pid);
      return pid;
    }
  });

  return 0;
}

WalletShellManager.prototype.getWalletAddress = function() {
  let walletAddress = wsession.get('loadedWalletAddress');
  return walletAddress;
}

WalletShellManager.prototype.getPlatform = function() {
  return plat;
}

WalletShellManager.prototype.getResourcesPath = function() {
  return process.resourcesPath;
}

WalletShellManager.prototype.getMinerPid = function() {
  return this.minerPid;
}

WalletShellManager.prototype.runHyperboria = function(cjdnsBin, cjdnsArgs, hyperConsole) {

  // just stub it out...
  return true;


//  //log.warn("run Hyperboria with args: "+cjdnsArgs);
//  //let argo = JSON.parse(cjdnsArgs);
//  if (this.hyperPid > 0) {
//    // if it's already running just return
//    return true;
//  }
//
//  try {
//    //log.warn("spawning: "+cjdnsBin);
//    this.hyperProcess = childProcess.spawn(cjdnsBin, {},
//      {detached: false, stdio: ['pipe','pipe','pipe']}); // ... , encoding: 'utf-8'});
//    this.hyperPid = this.hyperProcess.pid;
//
//    this.hyperProcess.stdout.on('data', function(chunk) {
//      this.hyperBuf += chunk;
//      hyperConsole(this.hyperBuf);
//      this.hyperBuf = '';
//    });
//    this.hyperProcess.stderr.on('data', function(chunk) {
//      hyperConsole(chunk);
//    });
//
//    //this.hyperProcess.stdin.setEncoding('utf-8');
//    //this.hyperProcess.stdin.write(cjdnsArgs + '\n');
//    this.hyperProcess.stdin.end(cjdnsArgs);
//  } catch(e) {
//    log.warn(`cjdns is not running: %j`, e);
//    return false;
//  }
}

WalletShellManager.prototype.runMiner = function(minerBin, minerArgs, updateConsole) {

  //confirm("run miner args: "+minerArgs);
  //confirm("run miner path: "+minerBin);

  //Kill any existing miner process if it is re-run
  if (this.minerPid > 0) {
    this.killMiner(this.minerPid);
    this.minerProcess = null;
    this.minerPid = 0;
    return;
  }
  else {
    let mpid = this.getMinerPID(); 
    if (mpid > 0) {
      this.killMiner(mpid);
      this.minerProcess = null;
      this.minerPid = 0;
      return;
    }
  }

  try{
    this.minerProcess = childProcess.spawn(minerBin, minerArgs,
      {detached: false, stdio: ['ignore','pipe','pipe'], encoding: 'utf-8'});
    this.minerPid = this.minerProcess.pid;

    this.minerProcess.stdout.on('data', function(chunk) {
      this.chunkBufr += chunk.toString();
      updateConsole(this.chunkBufr);
      this.chunkBufr = '';
    });
    this.minerProcess.stderr.on('data', function(chunk) {
      updateConsole(chunk.toString());
    });
  } catch(e) {
    log.warn("xmr-stak error");
    return false;
  }

  this.minerProcess.on('error', (err) => {
    this.killMiner(this.minerPid);
    this.minerProcess = 0;
    this.minerPid = 0;
    log.warn(`xmr-stak error: ${err.message}`);
  });
}

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

function cleanAddress(aAddr) {
  let inAddr = aAddr.trim();
  let walletAddress = inAddr;
  if (inAddr.length > 0) {
    let alocat = inAddr.indexOf("Address:");
    if (alocat >= 0) {
      //log.warn("CLEAN ADDR: "+inAddr);
      walletAddress = inAddr.substring(alocat+9);
      //log.warn("WALLET ADDRESS CLEANED: "+walletAddress);
    }
  }

log.warn("The walletAddress: "+walletAddress);

  return walletAddress;
}

WalletShellManager.prototype.callSpawn = function(walletFile, password, onError, onSuccess, onDelay) {

    // The purpose of this is to make sure that the walletd
    // does not run within the process space of the original
    // spawn call used to verify the password and wallet address
    setTimeout(() => {
        // Possible future work on embedded status page...
        //= webBrowser1.Document.GetElementById("pool_yourStats push-up-20").OuterHtml;
        //let addr_cookie = "address="+walletAddress;
        //let body_content = getHttpContent("https://fedreserve.cryptonote.club", "/#worker_stats", addr_cookie);
        //log.warn("cryptonote.club: "+body_content.length);

      this._spawnService(walletFile, password, onError, onSuccess, onDelay);
    }, 3000, walletFile, password, onError, onSuccess, onDelay);
}

WalletShellManager.prototype.startService = function(walletFile, password, onError, onSuccess, onDelay) {

  if (this.syncWorker) this.stopSyncWorker();
  if (null !== this.serviceLastPid) {
    // try to kill last process, in case it was stalled
    log.debug(`Trying to clean up old/stalled process, target pid: ${this.serviceLastPid}`);
    try{
      process.kill(this.serviceLastPid, 'SIGKILL');
    }catch(e){}
  }

  // Note: the path Must be quoted in order to work properly on all platforms...
  let runBin = this.serviceBin.split(' ').join("\\ ");
  runBin = runBin+' --container-file "'+walletFile+'" --container-password "'+password+
    '" --log-level 0 --address';

  this.stdBuf = "";
  var wsm = this;

  this.walletProcess = childProcess.exec(runBin, { timeout: 30000, maxBuffer: 2000 * 1024, env: {x: 0} });
  this.walletProcess.on('close', () => {
      if ((wsm.stdBuf.length == 0) || (wsm.stdBuf.search("password is wrong") >= 0)) {
        onError("Password: "+ERROR_WALLET_PASSWORD+": "+wsm.stdBuf);
      } else {
        this.init(password);
        //log.warn("raw address: "+wsm.stdBuf);
        let walletAddress = cleanAddress(wsm.stdBuf);
        if (walletAddress.length <= 0) {
          log.warn("could not get walletAddress...");
          onError("Getting address: "+ERROR_WALLET_PASSWORD);
          return;
        } else {
          //log.warn("Wallet ADDRESS is (should not include label): "+walletAddress);
          wsession.set('loadedWalletAddress', walletAddress);
          this.callSpawn(walletFile, password, onError, onSuccess, onDelay);
        }
      }
  });
  this.walletProcess.stdout.on('data', function(chunky) {
    wsm.stdBuf += chunky.toString();
  });
  this.walletProcess.on('error', (err) => {
    onError("Error: "+ERROR_WALLET_PASSWORD);
  });
}

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

    // Calculates network top block at time wallet is started.  It's is okay
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
// JUST RUN LOCAL FOR NOW ... REMOTE IS UNRELIABLE DUE TO NETWORK
// - PERHAPS WORKS ON CJDNS
//    if ((cblock > 0) && (tblock > 0) && ((9000+cblock) > tblock)) {

      // NO LONGER REQUIRE THIS AS YOU CANNOT OPEN WALLET DURING A RESCAN NOW...
      // This detects if the local daemon was forced into a full resync or rescan also...
      //if (6000+daemonHeight > tblock) {

      daemonAd = '127.0.0.1';
      daemonPt = settings.get('daemon_port');
      bRemoteDaemon = false;
//    }

    //log.warn("heightVal: "+daemonHeight);
    //log.warn("current block: "+cblock);
    //log.warn("block height: "+tblock);
    //log.warn("priNode: "+priNode);
    //log.warn("secNode: "+secNode);
    //log.warn("daemon address: "+daemonAd);
    //log.warn("daemon port: "+daemonPt);
    //log.warn("walletFile: "+walletFile);

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
        '--log-level', 0,
        '--add-priority-node', priNode,
        '--add-priority-node', secNode,
        '--local'
      ];

      //log.warn("integrated daemon mode");
    }
    else {
      if (DEBUG) {
        serviceArgs = [
          '--data-dir', remote.app.getPath('userData'),
          '--container-file', walletFile,
          '--container-password', password,
          '--bind-address', '127.0.0.1',
          '--bind-port', this.walletdPort,
          '--rpc-user', 'fedadmin',
          '--rpc-password', password,
          '--daemon-address', daemonAd,
          '--daemon-port', daemonPt,
          '--log-level', 4, //0,
          '--log-file', '/home/jojapoppa/Desktop/debug.log'
        ];
      } else {
        serviceArgs = [
          '--data-dir', remote.app.getPath('userData'),
          '--container-file', walletFile,
          '--container-password', password,
          '--bind-address', '127.0.0.1',
          '--bind-port', this.walletdPort,
          '--rpc-user', 'fedadmin',
          '--rpc-password', password,
          '--daemon-address', daemonAd,
          '--daemon-port', daemonPt,
          '--log-level', 0
        ];
      }
    }

    let wsm = this;
    log.warn("wallet.serviceBin path: "+wsm.serviceBin);
    log.warn("serviceArgs: "+serviceArgs);

    try{
        this.serviceProcess = childProcess.spawn(wsm.serviceBin, serviceArgs,
          {detached: false, stdio: ['pipe','pipe','pipe'], encoding: 'utf-8'});
          //{detached: false, stdio: ['ignore','pipe','pipe'], encoding: 'utf-8'});
        this.servicePid = this.serviceProcess.pid;
    } catch(e) {
        if (onError) onError(ERROR_WALLET_EXEC);
        log.error(`${config.walletServiceBinaryFilename} is not running`);
        return false;
    }

    this.serviceProcess.on('close', () => {

        wsm.serviceApi.stop();
        setTimeout(() => {
          wsm.terminateService(true);
        }, 3000);

        log.debug(`${config.walletServiceBinaryFilename} closed`);
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

    wsession.set('connectedNode', `${settings.get('daemon_host')}:${settings.get('daemon_port')}`);
    this.serviceActiveArgs = serviceArgs;

    log.warn("calling startSyncWorker...");
    this.startSyncWorker(password, daemonAd, daemonPt);
    let addr = wsession.get('loadedWalletAddress');

    setTimeout(function() {
      wsm.notifyUpdate({
        type: 'addressUpdated',
        data: addr 
      });
    }, 125, wsm, addr);

    log.warn("calling onSuccess()...");
    onSuccess();
};

WalletShellManager.prototype.stopService = function(){

    this.killMiner(this.minerPid);

    let wsm = this;
    return new Promise(function (resolve){
        if(wsm.serviceStatus()){
            wsm.serviceLastPid = wsm.serviceProcess.pid;
            wsm.stopSyncWorker();
            wsm.serviceApi.save().then(() =>{
                try{
                    wsm.serviceApi.stop();
                    setTimeout(() => {
                      wsm.terminateService(true);
                    }, 1000);
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
      //log.warn("syncWorker is already running... restarting it.");
      try{this.syncWorker.kill('SIGKILL');}catch(e){}
      this.syncWorker = null;
    }

    let wsm = this;
    wsm.syncWorker = childProcess.fork(path.join(__dirname,'ws_syncworker.js'));

    wsm.syncWorker.on('message', function(msg) {
      wsm.notifyUpdate(msg);
    });

    wsm.syncWorker.on('close', function() {
        try{wsm.syncWorker.kill('SIGKILL');}catch(e){}
        wsm.syncWorker = null;
        log.debug(`service worker terminated.`);
    });

    wsm.syncWorker.on('exit', function () {
        wsm.syncWorker = null;
        log.debug(`service worker exited.`);
    });

    wsm.syncWorker.on('error', function(err) {
        try{wsm.syncWorker.kill('SIGKILL');}catch(e){}
        wsm.syncWorker = null;
        log.debug(`service worker error: ${err.message}`);
    });

    let wallAddress = wsession.get('loadedWalletAddress');

    let cfgData = {
      type: 'start',
      data: {
        daemon_host: daemonAd,
        daemon_port: daemonPt,
        walletd_host: wsm.walletdHost,
        walletd_port: wsm.walletdPort,
        walletd_password: password,
        address: wallAddress,
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

        setTimeout(function () {
            if (this.syncWorker != undefined) {
              this.syncWorker.kill('SIGTERM');
              this.syncWorker  = null;
            }
        }, 500);
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
            ['--container-file', walletFile,
             '--container-password', password,
             '--log-level', SERVICE_LOG_LEVEL,
             '--generate-container']
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

WalletShellManager.prototype.importFromKeys = function(walletFile, password, viewKey, spendKey, scanHeight) {
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
            '--log-level', 0,
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

WalletShellManager.prototype.sendTransaction = function(useMixin, params){
    let wsm = this;
    return new Promise((resolve, reject) => {
        wsm.serviceApi.sendTransaction(useMixin, params).then((result) => {
            return resolve(result);
        }).catch((err) => {
            //log.warn("walletshellmgr: "+err);
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
        let unlockedbal = wsession.get('walletUnlockedBalance');
        log.warn("unlocked balance: "+unlockedbal);

        threshold = threshold || (parseInt(unlockedbal,10)*100000000)+1;
        minThreshold = minThreshold || threshold;
        maxFusionReadyCount = maxFusionReadyCount || 0;
       
        log.warn("Fusion params...");
        log.warn("counter: "+counter);
        log.warn("threshold: "+threshold);
        log.warn("minThreshold: "+minThreshold);
        log.warn("maxFusionReadyCount: "+maxFusionReadyCount);
 
        let maxThreshCheckIter = 20;
        let walletAddress = wsession.get('loadedWalletAddress');

        wsm.serviceApi.estimateFusion({threshold: threshold, addresses: [walletAddress]}).then((res)=>{

            log.warn("return from api.estimateFusion...");
            log.warn("res.fusionReadyCount: "+res.fusionReadyCount);
            log.warn("maxFusionReadyCount: "+maxFusionReadyCount);

            // nothing to optimize
            if( counter === 0 && res.fusionReadyCount === 0) return resolve(0); 
            // stop at maxThreshCheckIter or if threshold too low
            if( counter > maxThreshCheckIter || threshold < 10) return resolve(minThreshold);

            // we got a possibly best minThreshold
            if(res.fusionReadyCount < maxFusionReadyCount){
                return resolve(minThreshold);
            }
            // continue to find next best minThreshold
            maxFusionReadyCount = res.fusionReadyCount;
            minThreshold = threshold;
            threshold = Math.round(threshold / 2);
            counter += 1;
            resolve(wsm._fusionGetMinThreshold(threshold, minThreshold, maxFusionReadyCount, counter).then((res)=>{
                return res;
            }));
        }).catch((err)=>{
            log.warn("Fusion err: "+err);
            return reject(new Error(err));
        });
    });
};

WalletShellManager.prototype._fusionSendTx = function(threshold, counter){
    let wsm = this;

    // a blocking timer for nodejs
    const wtime = ms => new Promise(resolve => setTimeout(resolve, ms));

    log.warn("_fusionSendTx threshold: "+threshold+" counter: "+counter);
    return new Promise((resolve, reject) => {
        counter = counter || 0;
        let maxIter = 256;
        if(counter >= maxIter) return resolve(wsm.fusionTxHash); // stop at max iter
      
        // just stop if balance gets locked 
        //const lockedBalance = wsession.get('walletLockedBalance');
        //if (lockedBalance > 0) {
        //  log.warn("Some balance locked, will stop fusion now.");
        //  return resolve(lockedBalance);
        //}

        log.warn("wtime...");

        wtime(4000).then(() => {

          // keep sending fusion tx till it hit IOOR or reaching max iter
          let fusionStat = "send fusion tx, iteration: "+(counter+1);
          log.warn(fusionStat);
          wsm.notifyUpdate({
            type: 'fusionStatus',
            data: fusionStat 
          });

          let walletAddress = wsession.get('loadedWalletAddress');
          log.warn("walletAddress: "+walletAddress);
          log.warn("threshold: "+threshold);
          wsm.serviceApi.sendFusionTransaction({threshold: threshold, anonymity: 0, addresses: [walletAddress], destinationAddress: walletAddress}).then((resp)=> {
            log.warn("back from fusion send");
            log.warn("fusion hash: "+resp.transactionHash);
            wsm.fusionTxHash.push(resp.transactionHash);
            counter +=1;
            return resolve(wsm._fusionSendTx(threshold, counter).then((resp)=>{
                return resp;
            }));
          }).catch((err)=>{
            //log.warn("exception from sendFusionTransaction...");
            return reject(new Error(err));
          });
        });
    });
};

WalletShellManager.prototype.optimizeWallet = function(){
    let wsm = this;
    return new Promise( (resolve, reject) => {
        wsm.fusionTxHash = [];

//        let minT = 100;
//        log.warn("starting out with min threshold: "+minT);
//        wsm._fusionGetMinThreshold(minT).then((res)=>{
//
//            if (res<=0) res = minT;
//            //if(res <= 0 ){
//            //    wsm.notifyUpdate({
//            //        type: 'fusionTxCompleted',
//            //        data: INFO_FUSION_SKIPPED
//            //    });
//            //    return resolve(INFO_FUSION_SKIPPED);
//            //}

         wsm._fusionGetMinThreshold().then((res)=>{
             if(res <= 0 ){
                 wsm.notifyUpdate({
                     type: 'fusionTxCompleted',
                     data: INFO_FUSION_SKIPPED
                 });
                 return resolve(INFO_FUSION_SKIPPED);
             }

            log.warn(`performing fusion tx, threshold: ${res}`);
            return resolve(
                wsm._fusionSendTx(res, 0).then(() => {
                    wsm.notifyUpdate({
                        type: 'fusionTxCompleted',
                        data: INFO_FUSION_DONE
                    });
                    return INFO_FUSION_DONE;
                }).catch((err)=>{
                    let msg = err.message.toLowerCase();
                    let outMsg = ERROR_FUSION_FAILED;
                    log.warn("Fusion error: "+msg);
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
