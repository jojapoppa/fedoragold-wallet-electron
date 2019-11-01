const {app, dialog, Tray, Menu} = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const screen = require('screen');
const http = require('http'); //jojapoppa, do we need both http and https?
const https = require('https');
const request = require('request-promise-native');
const platform = require('os').platform();
const crypto = require('crypto');
const Store = require('electron-store');
const settings = new Store({name: 'Settings'});
const log = require('electron-log');
const splash = require('@trodi/electron-splashscreen');
const config = require('./src/js/ws_config');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const net = require('net');
const { autoUpdater } = require("electron-updater");
const { setIntervalAsync } = require('set-interval-async/fixed');

const IS_DEV  = (process.argv[1] === 'dev' || process.argv[2] === 'dev');
const IS_DEBUG = IS_DEV || process.argv[1] === 'debug' || process.argv[2] === 'debug';
const LOG_LEVEL = IS_DEBUG ? 'debug' : 'warn';

log.transports.console.level = LOG_LEVEL;
log.transports.file.level = LOG_LEVEL;
log.transports.file.maxSize = 5 * 1024 * 1024;

const WALLETSHELL_VERSION = app.getVersion() || '0.0.0';

// the os modules platform() call returns win32 even for 64 bit systems... so the "win32" stuff below is fine...
const SERVICE_FILENAME =  (platform === 'win32' ? `${config.walletServiceBinaryFilename}.exe` : config.walletServiceBinaryFilename );
const DAEMON_FILENAME =  (platform === 'win32' ? `${config.daemonBinaryFilename}.exe` : config.daemonBinaryFilename );
const SERVICE_OSDIR = (platform === 'win32' ? 'win' : (platform === 'darwin' ? 'mac' : 'linux'));
const DEFAULT_SERVICE_BIN = path.join(process.resourcesPath,'bin', SERVICE_OSDIR, SERVICE_FILENAME);
const DEFAULT_DAEMON_BIN = path.join(process.resourcesPath,'bin', SERVICE_OSDIR, DAEMON_FILENAME);
const DEFAULT_SETTINGS = {
    service_bin: DEFAULT_SERVICE_BIN,
    daemon_bin: DEFAULT_DAEMON_BIN,
    walletd_host: '127.0.0.1',
    walletd_port: config.walletServiceRpcPort,
    walletd_password: crypto.randomBytes(32).toString('hex'),
    daemon_host: config.remoteNodeDefaultHost,
    daemon_port: config.daemonDefaultRpcPort,
    pubnodes_date: null,
    pubnodes_data: config.remoteNodeListFallback,
    pubnodes_custom: ['127.0.0.1:31875'],
    darkmode: true,
    service_config_format: config.walletServiceConfigFormat
};
const DEFAULT_SIZE = { width: 840, height: 695 };

app.prompExit = true;
app.prompShown = false;
app.setAppUserModelId(config.appId);
app.fsync = null;
app.timeStamp = 0;
app.chunkBuf = '';

app.daemonPid = null;
app.daemonLastPid = null;
app.localDaemonRunning = false;
app.localDaemonSynced = false;
app.foundLocalDaemonPort = 0;

log.info(`Starting WalletShell ${WALLETSHELL_VERSION}`);

const sleepMils = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

let win = null;
function createWindow () {

    // Create the browser window.
    let darkmode = settings.get('darkmode', true);
    let bgColor = darkmode ? '#000000' : '#FFCC33';   // '#FFCC33'; //jojapoppa

    const winOpts = {
        title: `${config.appName} ${config.appDescription}`,
        //title: `${config.appDescription}`,
        icon: path.join(__dirname,'src/assets/walletshell_icon.png'),
        frame: true,
        width: DEFAULT_SIZE.width,
        height: DEFAULT_SIZE.height,
        minWidth: DEFAULT_SIZE.width,
        minHeight: DEFAULT_SIZE.height,
        show: false,
        backgroundColor: bgColor,
        center: true,
    };

    win = splash.initSplashScreen({
        windowOpts: winOpts,
        templateUrl: path.join(__dirname, "src/html/splash.html"),
        delay: 0, 
        minVisible: 3000,
        splashScreenOpts: {
            width: 425,
            height: 325,
            transparent: true
        },
    });

    win.on('show', () => {
      autoUpdater.checkForUpdatesAndNotify();
      autoUpdater.addListener("update-available", function (event) {
        const dialogOpts = {
          type: 'info',
          buttons: ['OK'],
          title: 'Application Update',
          message: 'A new version of FedoraGold Wallet (FED) is available.',
        }
      
        dialog.showMessageBox(dialogOpts, (response) => { });
        //inside function-> if (response === 0) autoUpdater.quitAndInstall()
      });
    });

    win.on('hide', () => {});
    win.on('minimize', (event) => {});

    //load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'src/html/index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // open devtools
    if(IS_DEV ) win.webContents.openDevTools();

    // show window
    win.once('ready-to-show', () => {
        win.setTitle(`${config.appDescription}`);
        app.timeStamp = Math.floor(Date.now());
    });

    win.on('close', (e) => {
        if(app.prompExit ){
          e.preventDefault();
          win.webContents.send('promptexit','promptexit');
        }
    });
    
    win.on('closed', () => {
        win = null;
    });

    win.setMenu(null);

    // misc handler
    win.webContents.on('crashed', () => { 
        // todo: prompt to restart
        log.debug('webcontent was crashed');
    });

    win.on('unresponsive', () => {
        // todo: prompt to restart
        log.debug('webcontent is unresponsive');
    });
}

function storeNodeList(pnodes){
    pnodes = pnodes || settings.get('pubnodes_data');
    let validNodes = [];
    if( pnodes.hasOwnProperty('nodes')){
        pnodes.nodes.forEach(element => {
            let item = `${element.url}:${element.port}`;
            validNodes.push(item);
        });
    }
    if(validNodes.length) settings.set('pubnodes_data', validNodes);
}

function doNodeListUpdate(){
    try{
        https.get(config.remoteNodeListUpdateUrl, (res) => {
            var result = '';
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
                result += chunk;
            });

            res.on('end', () => {
                try{
                    var pnodes = JSON.parse(result);
                    let today = new Date();
                    storeNodeList(pnodes);
                    log.debug('Public node list has been updated');
                    let mo = (today.getMonth()+1);
                    settings.set('pubnodes_date', `${today.getFullYear()}-${mo}-${today.getDate()}`);
                }catch(e){
                    log.debug(`Failed to update public node list: ${e.message}`);
                    storeNodeList();
                }
            });
        }).on('error', (e) => {
            log.debug(`Failed to update public-node list: ${e.message}`);
        });
    }catch(e){
        log.error(`Failed to update public-node list: ${e.code} - ${e.message}`);
    }
}

function serviceBinCheck(){

    // This stops the copy on platforms that don't use the mounts such as osx/mac	
    if(!DEFAULT_SERVICE_BIN.startsWith('/tmp')){
        return;
    }
    if(!DEFAULT_DAEMON_BIN.startsWith('/tmp')){
        return;
    }

    let targetPath = path.join(app.getPath('userData'), SERVICE_FILENAME);
    let daemonPath = path.join(app.getPath('userData'), DAEMON_FILENAME);

    try{
        fs.renameSync(targetPath, `${targetPath}.bak`, (err) => {
            if(err) log.error(err);
        });
        fs.renameSync(daemonPath, `${daemonPath}.bak`, (err) => {
            if(err) log.error(err);
        });
    }catch(_e){}
    
    try{
        fs.copyFile(DEFAULT_DAEMON_BIN, daemonPath, (err) => {
          if (err){
            log.error(err);
            return;
          }
          settings.set('daemon_bin', daemonPath);
          log.debug(`daemon service binary copied to ${daemonPath}`);
        });

        fs.copyFile(DEFAULT_SERVICE_BIN, targetPath, (err) => {
          if (err){
            log.error(err);
            return;
          }
          settings.set('service_bin', targetPath);
          log.debug(`walletd service binary copied to ${targetPath}`);
        });
    }catch(_e){}
}

daemonStatus = function(){
    return  (undefined !== this.daemonProcess && null !== this.daemonProcess);
};

terminateDaemon = function() {
    app.daemonLastPid = app.daemonPid;
    try{
        if (daemonStatus()) this.daemonProcess.kill('SIGINT');
        //if (daemonStatus()) this.daemonProcess.kill('SIGTERM');
        //if (app.daemonPid) process.kill(app.daemonPid, 'SIGTERM');
    }catch(e){}

//    sleepMils(1000);
//    if (this.daemonProcess) {
//      log.warn(`SIGKILLing ${config.daemonBinaryFilename}`);
//      if (daemonStatus()) try{this.daemonProcess.kill('SIGKILL');}catch(err){}
//      if (app.daemonPid) try{process.kill(app.daemonPid, 'SIGKILL');}catch(err){}
//    }

    this.daemonProcess = null;
    app.daemonPid = null;
};

//process.on('unhandledRejection', error => {
  // Will print "unhandledRejection err is not defined"
  //console.log('unhandledRejection', error.message);
//});

function runDaemon() {

    var daemonPath;
    if (process.platform === 'darwin') {
      daemonPath = DEFAULT_DAEMON_BIN;
    }
    else {
      daemonPath = settings.get('daemon_bin');
    }

    // Don't allow binding on port 0 
    if (settings.get('daemon_port') === 0) {
        return;
    }

    try { this.daemonProcess.kill(); } catch(e) {} // just eat and ignore any errors
    require('events').EventEmitter.prototype._maxListeners = 100;

    let daemonArgs = [
      '--rpc-bind-ip', '127.0.0.1',
      '--rpc-bind-port', settings.get('daemon_port') 
    ];

    try {
      return new Promise(function(resolve, reject) {
        this.daemonProcess = spawn(daemonPath, daemonArgs, 
          {detached: false, stdio: ['ignore','pipe','pipe'], encoding: 'utf-8'});
        app.daemonPid = this.daemonProcess.pid;

        this.daemonProcess.stdout.on('data', function(chunk) {

          // limit to 1 msg every 1/4 second to avoid overwhelming message bus
          app.chunkBuf += chunk;
          var newTimeStamp = Math.floor(Date.now());
          if ((win !== null) && ((newTimeStamp-app.timeStamp) > 250)) {
            app.timeStamp = newTimeStamp;
            win.webContents.send('console', app.chunkBuf);
            app.chunkBuf = '';
          }
        });
        this.daemonProcess.stderr.on('data', function(chunk) {
          if (win !== null) {
            win.webContents.send('console',chunk);
          }
        });
      }); 
    } catch(e) {
      log.error(e.message);
    }
}

const checkDaemonTimer = setIntervalAsync(() => {

    var cmd = `ps -ex`;
    switch (process.platform) {
        case 'win32' : cmd = `tasklist`; break;
        case 'darwin' : cmd = `ps -ax | grep ${query}`; break;
        case 'linux' : cmd = `ps -A`; break;
        default: break;
    }

    var status = false;
    exec(cmd, {
        maxBuffer: 2000 * 1024
    }, function(error, stdout, stderr) {
        if (stdout.toLowerCase().indexOf('fedoragold_daem') > -1) {
            app.localDaemonRunning = true;
            settings.set('daemon_host', '127.0.0.1');
            app.foundLocalDaemonPort = settings.get('daemon_port');
            //log.warn('local daemon is running on port: ', settings.get('daemon_port'));
        } else {
            app.localDaemonRunning = false;
            app.foundLocalDaemonPort = 0;
        }
    });
}, 5000);

const checkSyncTimer = setIntervalAsync(() => {
    if (app.localDaemonRunning) {

        var myAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 8000
        });
        let headers = {
            Connection: 'Keep-Alive',
            Agent: myAgent
        };

        request(`http://${settings.get('daemon_host')}:${settings.get('daemon_port')}/iscoreready`, {
            method: 'GET',
            headers: headers,
            body: {jsonrpc: '2.0'},
            json: true,
            timeout: 10000
        }, (error, response, body) => {
              if (! error) {
                  if (body.iscoreready) {
                      app.localDaemonSynced = true;
                  }
              }
              else {
                  app.localDaemonSynced = false;
              }
        }).catch(function(e){}); // Just eat the error as race condition expected anyway...
    }
}, 20000);

/*
const checkFallback = setIntervalAsync(() => {
    var myAgent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 10000
    });
    let headers = {
        Connection: 'Keep-Alive',
        Agent: myAgent
    };

    let pnodes = settings.get('pubnodes_data');
    let remoteDaemonNode = pnodes
        .map((a) => ({ sort: Math.random(), value: a }))
        .sort((a, b) => a.sort - b.sort)
        .map((a) => a.value)[0];
    let locat = remoteDaemonNode.search(':');

    try {
        var client = net.connect(remoteDaemonNode.substring(locat+1),remoteDaemonNode.substring(0, locat),
          function() { 
            client.end();
            //log.warn('found fallback daemon at: ', app.foundRemoteDaemonHost);
          });
        client.on('error', function(error) {
            client.end(); // do nothing
        });
    } catch (e) {} // just eat any errors, so that the previous good daemon HostIP is retained...

}, 30000);
*/

function initSettings(){
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
        if(!settings.has(k) || settings.get(k) === null){
            if(DEFAULT_SETTINGS[k]===undefined){
		log.debug(`value of default setting is undefined for: ${k}`); 
                settings.set(k, '');
	    } 
            else {
                settings.set(k, DEFAULT_SETTINGS[k]);
            }
        }
    });
    settings.set('version', WALLETSHELL_VERSION);
    serviceBinCheck();
}

const silock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
    if (win) {
        if (!win.isVisible()) win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});
if (!silock) app.quit();

app.on('ready', () => {
    initSettings();

    if(IS_DEV || IS_DEBUG) log.warn(`Running in ${IS_DEV ? 'dev' : 'debug'} mode`);

    global.wsession = {
        debug: IS_DEBUG
    };

    if(config.remoteNodeListUpdateUrl){
        let today = new Date();
        let last_checked = new Date(settings.get('pubnodes_date'));
        let diff_d = parseInt((today-last_checked)/(1000*60*60*24),10);
        if(diff_d >= 1){
            log.info('Performing daily public-node list update.');
            doNodeListUpdate();
        }else{
            log.info('Public node list up to date, skipping update');
            storeNodeList(false); // from local cache
        }
    }
    
    createWindow();
    // try to target center pos of primary display
    let eScreen = require('electron').screen;
    let primaryDisp = eScreen.getPrimaryDisplay();
    let tx = Math.ceil((primaryDisp.workAreaSize.width - DEFAULT_SIZE.width)/2);
    let ty = Math.ceil((primaryDisp.workAreaSize.height - (DEFAULT_SIZE.height))/2);
    if(tx > 0 && ty > 0) win.setPosition(parseInt(tx, 10), parseInt(ty,10));

    app.emit('run-daemon');
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    //if (platform !== 'darwin') 
    app.quit();
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) createWindow();
});

app.on('run-daemon', () => {
    runDaemon();
});

process.on('uncaughtException', function (e) {
    log.error(`Uncaught exception: ${e.message}`);
    process.exit(1);
});

process.on('beforeExit', (code) => {
    log.debug(`beforeExit code: ${code}`);
});

process.on('exit', (code) => {
    terminateDaemon();
    log.debug(`exit with code: ${code}`);
});

process.on('warning', (warning) => {
    log.warn(`${warning.code}, ${warning.name}`);
});
