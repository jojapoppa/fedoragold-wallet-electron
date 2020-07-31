const {app, dialog, Tray, Menu} = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const http = require('http'); //jojapoppa, do we need both http and https?
const https = require('https');
const killer = require('tree-kill');
const request = require('request-promise-native');
const opsys = require('os');
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
const navigator = require('navigator');
const disk = require('diskusage');
const { autoUpdater } = require("electron-updater");
const { setIntervalAsync } = require('set-interval-async/fixed');

process.env.UV_THREADPOOL_SIZE = 128;

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
//const DEFAULT_CJDNS_BIN = path.join(process.resourcesPath,'bin', SERVICE_OSDIR, 'cjdroute');
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
app.daemonProcess = null;
app.daemonLastPid = null;
app.localDaemonRunning = false;
app.integratedDaemon = false;
app.heightVal = 0;

//app.cjdnsProcess=null;
//app.cjdnsArgs=null;
//app.cjdnsPid=null;

app.primarySeedAddr = '18.222.96.134';
app.secondarySeedAddr = '18.223.178.174'
app.primarySeedHeight = 0;

// Special syntax for main window...
let win, callback;

log.info(`Starting WalletShell ${WALLETSHELL_VERSION}`);

function msleep(n) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
}
function sleep(n) {
  msleep(n*1000);
}

function ensureSafeQuitAndInstall() {
    const electron = require('electron');
    const app = electron.app;
    const BrowserWindow = electron.BrowserWindow;
    app.removeAllListeners('window-all-closed');
    var browserWindows = BrowserWindow.getAllWindows();
    browserWindows.forEach(function(browserWindow) {
        browserWindow.removeAllListeners('close');
    });
}

function createWindow () {

    // Create the browser window.
    let darkmode = settings.get('darkmode', true);
    let bgColor = darkmode ? '#000000' : '#FFCC33';   // '#FFCC33'; //jojapoppa

    const winOpts = {
        title: `${config.appName} ${config.appDescription}`,
        icon: path.join(__dirname,'src/assets/walletshell_icon.png'),
        frame: true,
        width: DEFAULT_SIZE.width,
        height: DEFAULT_SIZE.height,
        transparent: false,
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

    // Tried embedding ..Version ${versionInfo.version} has been.. in the text, but the version # doesn't display
    //   so, I gave up and just made the message generic...
    win.on('show', () => {
      autoUpdater.autoDownload = true;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.logger = log;
      autoUpdater.logger.transports.file.level = "info";
      autoUpdater.checkForUpdatesAndNotify();
      autoUpdater.on('update-downloaded', (versionInfo) => {
        var dialogOptions = {
          type: 'question',
          defaultId: 0,
          title: 'FED Update Downloaded and Ready for Install',
          message: 'A FedoraGold (FED) update is ready to install, the update has been downloaded and will be automatically installed when you click OK.'
        };
        dialog.showMessageBox(win, dialogOptions, function() {
          ensureSafeQuitAndInstall();
          autoUpdater.quitAndInstall();
        });
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
    if(IS_DEV && (win!==null)) win.webContents.openDevTools();

    // show window
    win.once('ready-to-show', () => {
        win.setTitle(`${config.appDescription}`);
        app.timeStamp = Math.floor(Date.now());
    });

    win.on('close', (e) => {
        if(app.prompExit ){
          e.preventDefault();
          if (win!==null) win.webContents.send('promptexit','promptexit');
        }
    });
    
    win.on('closed', () => {
        win = null;
    });

    if (win!=null) win.setMenu(null);

    // misc handler
    if (win !== null) {
      win.webContents.on('crashed', () => { 
        // todo: prompt to restart
        log.debug('webcontent was crashed');
      });
    }

    win.on('unresponsive', () => {
        // todo: prompt to restart
        log.debug('webcontent is unresponsive');
    });
}

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

function logDataStream(data) {
  // log the binary data stream in rows of 8 bits
  var print = "";
  for (var i = 0; i < data.length; i++) {
    print += " " + data[i].toString(16);

    // apply proper format for bits with value < 16, observed as int tuples
    if (data[i] < 16) { print += "0"; }

    // insert a line break after every 8th bit
    if ((i + 1) % 8 === 0) {
      print += '\n';
    }
  }
  log.warn("sock: "+print);
}

// This function create and return a net.Socket object to represent TCP client.
function getConn(connName, porto) {

  try {

    var option = {
        host:'localhost',
        port: porto
    }

    // Create TCP client.
    var client = net.createConnection(option, function () {
        log.warn('Connection name : ' + connName);
        log.warn('Connection local address : ' + client.localAddress + ":" + client.localPort);
        log.warn('Connection remote address : ' + client.remoteAddress + ":" + client.remotePort);
    });

    client.setTimeout(1000);
    client.setEncoding('utf8');

    // When receive server send back data.
    client.on('data', function (datr) {
        log.warn('Server return data : ' + datr);
        logDataStream(datr);
    });

    // When connection disconnected.
    client.on('end',function () {
        log.warn('Client socket disconnect. ');
    });

    client.on('timeout', function () {
        log.warn('Client connection timeout. ');
    });

    client.on('error', function (err) {
        log.warn(JSON.stringify(err));
    });

  } catch (e) {
    log.warn(`Failed to connect to port for socks5: ${e.message}`);
  }

  return client;
}

setTimeout(function runSocks5Proxy() {

  log.warn("runSocks5Proxy");

  // Create a java client socket.
  var javaClient = getConn('Java', 49873);

  // Create node client socket.
  var nodeClient = getConn('Node', 49873);

  javaClient.write('Java is best programming language. ');
  nodeClient.write('Node is more better than java. ');

  //  client.on("data", function(datr) {
  //    // pack incoming data into the buffer
  //    buffer = Buffer.concat([buffer, Buffer.from(datr, 'hex')]);
  //  });
  //var Struct = require('struct').Struct;
  //function makeAndParsePersonFromBinary(buffer){  
  //var person = new Struct()
  //                  .('word8', 'Sex')     // 0 or 1 for instance
  //                  .('word32Ule', 'Age')
  //                  .('chars','Name', 64);
  //person._setBuff(buffer);
  //return person;
  //};
  //var incomingPerson = makeAndParsePersonFromBinary(buffer);  
  //var personName = incomingPerson.get('Name');  
}, 14000);

const checkSeedTimer = setIntervalAsync(() => {
  var aurl = "http://"+app.primarySeedAddr+":30159/getheight";
  getHttpContent(aurl)
  //grab whateveris between the : and the ,
  .then((html) => app.primarySeedHeight = html.match(/(?<=:\s*).*?(?=\s*,)/gs))
  .catch((err) => app.primarySeedHeight = 0);

}, 2500);

const checkDaemonHeight = setIntervalAsync(() => {
  var aurl = `http://127.0.0.1:${settings.get('daemon_port')}/getheight`;
  getHttpContent(aurl)
  //grab whateveris between the : and the ,
  .then((html) => app.heightVal = html.match(/(?<=:\s*).*?(?=\s*,)/gs))
  .catch((err) => app.heightVal = 0);
}, 2500);

function splitLines(t) { return t.split(/\r\n|\r|\n/); }
const checkDaemonTimer = setIntervalAsync(() => {
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
    exec(cmd, {
        maxBuffer: 2000 * 1024,
        env: {x: 0}
    }, function(error, stdout, stderr) {

        if (error) {
          log.warn("error testing for daemon: "+error.message.toString());
          return;
        } else if (stderr.length > 0) {
          log.warn("err testing for daemon: "+stderr+" \n");
          return;
        }

        procStr = stdout.toString();
        procStr = procStr.replace(/[^a-zA-Z0-9_ .:;,?\n\r\t]/g, "");
        procStr = procStr.toLowerCase();
        let daemonAlreadyRunning = procStr.includes('fedoragold_daem');
        //if (! daemonAlreadyRunning) log.warn("\n\n\n\n\n\n\n\n\n\n\n"+procStr);

        if (daemonAlreadyRunning) {
          var dloc = procStr.indexOf('fedoragold_daem');
          procStr = procStr.substring(0, dloc);
          var procAry = splitLines(procStr);
          procStr = procAry[procAry.length-1];
          procStr = procStr.trim();
          //log.warn("detected PID is: "+parseInt(procStr.substr(0, procStr.indexOf(' ')), 10));

          if (app.daemonPid === null) {
            app.daemonPid = parseInt(procStr.substr(0, procStr.indexOf(' ')), 10); 
            var errmsg = "fedoragold_daemon process already running at process ID: "+app.daemonPid;
            log.warn(errmsg);
            app.localDaemonRunning = true;
            if (win!==null) win.webContents.send('console', errmsg);
            /* eslint-disable-next-line no-empty */
            try{killer(app.daemonPid,'SIGKILL');}catch(err){} 
            return;
          } else {
            app.localDaemonRunning = true;
          }
        } else {
          app.localDaemonRunning = false;
          app.daemonProcess = null;
          app.daemonPid = null;
          //log.warn("runDaemon()...");
          runDaemon();
        }
    });
}, 15000);

const checkSyncTimer = setIntervalAsync(() => {
    if (app.localDaemonRunning && (app.daemonPid !== null)) {

        var myAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 8000
        });
        let headers = {
            Connection: 'Keep-Alive',
            Agent: myAgent
        };

        // when was the last time we had console output?
        var newTimeStamp = Math.floor(Date.now());
        if (newTimeStamp - app.timeStamp > 300000) {  // (about 4mins)
          // if no response for over x mins then reset daemon... 
          terminateDaemon();

          // if the normal 'exit' command didn't work, then just wipe it out...
          if (newTimeStamp - app.timeStamp > 400000) {  // (about 6mins)
            /* eslint-disable-next-line no-empty */
            log.warn("calling killer to reset daemon");
            try{killer(app.daemonPid,'SIGKILL');}catch(err){log.warn("daemon reset...");}
            app.daemonProcess = null;
            app.daemonPid = null;
          }

          return;
        }

        request(`http://${settings.get('daemon_host')}:${settings.get('daemon_port')}/iscoreready`, {
            method: 'GET',
            headers: headers,
            body: {jsonrpc: '2.0'},
            json: true,
            timeout: 10000
        }, (error, response, body) => {
            if (!error && response.statusCode == 200) {
              if (body.iscoreready) {
                if (win!==null) win.webContents.send('daemoncoreready', 'true');
                return;
              }
            }
            if (win!==null) win.webContents.send('daemoncoreready', 'false');
        }).catch(function(e){}); // Just eat the error as race condition expected anyway...
    }
}, 4000);

function storeNodeList(pnodes){
    pnodes = pnodes || settings.get('pubnodes_data');
    let validNodes = [];

    //if( pnodes.hasOwnProperty('nodes')){
    if(!Object.prototype.hasOwnProperty.call(pnodes, 'nodes')){
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
    /* eslint-disable-next-line no-empty */
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
    /* eslint-disable-next-line no-empty */
    }catch(_e){}
}

process.on('unhandledRejection', function(err) {});
process.on('uncaughtException', function(err) {});
function terminateDaemon() {

    app.daemonLastPid = app.daemonPid;
    try{
      if (app.daemonProcess !== null) {

        // this offers clean exit on all platforms
        app.daemonProcess.stdin.write("exit\n");
        app.daemonProcess.stdin.end();
        log.warn("exit command sent to fedoragold_daemon");
      }
    }catch(e){/*eat any errors, no reporting nor recovery needed...*/}
}

function runDaemon() {

    // if there are insufficient resources, just run the daemon in thin mode 
    if (! checkMemoryAndStorage()) {
      return;
    }

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

    require('events').EventEmitter.prototype._maxListeners = 250;

    let daemonArgs = [
      '--rpc-bind-ip', '127.0.0.1',
      '--rpc-bind-port', settings.get('daemon_port'),
      '--add-priority-node', '18.222.96.134:30158', 
      '--add-priority-node', '18.223.178.174:30158'
    ];

    // unable to get this mode working yet, but seems to work for Meroex!
    app.integratedDaemon = false;
    app.chunkBuf = "\n ********Running Daemon from main.js ***********\n";
    var newTimeStamp;

    try {
        // daemon must run detached, otherwise windows will not exit cleanly
        if (! app.integratedDaemon) { 
          app.daemonProcess = spawn(daemonPath, daemonArgs, 
            {detached: true, stdio: ['pipe','pipe','pipe'], encoding: 'utf-8'});
          app.daemonPid = app.daemonProcess.pid;
        }

        app.daemonProcess.stdout.on('data', function(chunk) {
          // limit to 1 msg every 1/4 second to avoid overwhelming message bus
          app.chunkBuf += chunk;
          newTimeStamp = Math.floor(Date.now());
          if ((win !== null) && ((newTimeStamp-app.timeStamp) > 2500)) {
            app.timeStamp = newTimeStamp;
            win.webContents.send('console', app.chunkBuf);
            app.chunkBuf = '';
          }
        });
        app.daemonProcess.stderr.on('data', function(chunk) {
          log.warn("fedoragold_daemon error: "+chunk);
          if (win!==null) win.webContents.send('console',chunk);
        });
    } catch(e) {
      log.error(e.message);
    }
}

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
        var client = tcpSock.connect(remoteDaemonNode.substring(locat+1),remoteDaemonNode.substring(0, locat),
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

var gbStorageAvailable = 0;
disk.check('/', function(err, info) {
  gbStorageAvailable = (info.available / (1024 * 1024 * 1024)).toFixed(1);
});

function sendConsoleThinMsg() {
  if (win!==null) {
    let text = "thin mode...\nInsufficient memory or storage to run a local daemon.\n";
    text = text+"Wallet will therefore run with remote daemons.\n...\n";
    //log.warn(text);
    win.webContents.send('console', text);
  }
}

function checkMemoryAndStorage() {
  var gbMemoryAvailable = (opsys.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
  //log.warn("memoryAvailable: "+gbMemoryAvailable);
  //log.warn("storageAvailable: "+gbStorageAvailable);

  if ((gbMemoryAvailable < 2.5) || (gbStorageAvailable < 25)) {
    sendConsoleThinMsg();
    return false;
  }
  return true;
}

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
    var bounds = win.webContents.getOwnerBrowserWindow().getBounds();
    let tx = Math.ceil((bounds.width - DEFAULT_SIZE.width)/2);
    let ty = Math.ceil((bounds.height - (DEFAULT_SIZE.height))/2);
    if(tx > 0 && ty > 0) win.setPosition(parseInt(tx, 10), parseInt(ty,10));

    // run in directly the 1st time so that it boots up quickly 
    setTimeout(function(){ runDaemon(); }, 250);
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    //if (platform !== 'darwin') 

      if (win) {
            // yes, this needs to be done again...
            if(!win.isVisible()) win.show();
            if(win.isMinimized()) win.restore();
            win.focus();
      }

    app.quit();
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) createWindow();
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

//    // needs it twice for some reason on an application exit... unreliable otherwise...
//    try{
//      if (app.daemonProcess !== null) {
//        // this offers clean exit on all platforms
//        app.daemonProcess.stdin.write("exit\n");
//        app.daemonProcess.stdin.end();
//        //log.warn("exit command sent to fedoragold_daemon");
//      }
//    }catch(e){/*eat any errors, no reporting nor recovery needed...*/}
});

process.on('warning', (warning) => {
    log.warn(`${warning.code}, ${warning.name}`);
});
