const {app, dialog, Tray, Menu} = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const https = require('https');
const platform = require('os').platform();
const crypto = require('crypto');
const Store = require('electron-store');
const settings = new Store({name: 'Settings'});
const log = require('electron-log');
const splash = require('@trodi/electron-splashscreen');
const config = require('./src/js/ws_config');
const childDaemonProcess = require('child_process');

const IS_DEV  = (process.argv[1] === 'dev' || process.argv[2] === 'dev');
const IS_DEBUG = IS_DEV || process.argv[1] === 'debug' || process.argv[2] === 'debug';
const LOG_LEVEL = IS_DEBUG ? 'debug' : 'warn';

log.transports.console.level = LOG_LEVEL;
log.transports.file.level = LOG_LEVEL;
log.transports.file.maxSize = 5 * 1024 * 1024;

const WALLETSHELL_VERSION = app.getVersion() || '0.3.6';

// the os modules platform() call returns win32 even for 64 bit systems... so the "win32" stuff below is fine...
const SERVICE_FILENAME =  (platform === 'win32' ? `${config.walletServiceBinaryFilename}.exe` : config.walletServiceBinaryFilename );
const DAEMON_FILENAME =  (platform === 'win32' ? `${config.daemonBinaryFilename}.exe` : config.daemonBinaryFilename );
const SERVICE_OSDIR = (platform === 'win32' ? 'win' : (platform === 'darwin' ? 'mac' : 'linux'));
const DEFAULT_SERVICE_BIN = path.join(process.resourcesPath,'bin', SERVICE_OSDIR, SERVICE_FILENAME);
const DEFAULT_DAEMON_BIN = path.join(process.resourcesPath,'bin', SERVICE_OSDIR, DAEMON_FILENAME);
const DEFAULT_SETTINGS = {
    service_bin: DEFAULT_SERVICE_BIN,
    daemon_bin: DEFAULT_DAEMON_BIN,
    service_host: '127.0.0.1',
    service_port: config.walletServiceRpcPort,
    service_password: crypto.randomBytes(32).toString('hex'),
    daemon_host: config.remoteNodeDefaultHost,
    daemon_port: config.daemonDefaultRpcPort,
    pubnodes_date: null,
    pubnodes_data: config.remoteNodeListFallback,
    pubnodes_custom: ['127.0.0.1:31875'],
//jo    tray_minimize: false,
//jo    tray_close: false,
    darkmode: true,
    service_config_format: config.walletServiceConfigFormat
};
const DEFAULT_SIZE = { width: 840, height: 680 };

app.prompExit = true;
app.prompShown = false;
app.needToExit = false;
app.setAppUserModelId(config.appId);

app.daemonPid = null;
app.daemonLastPid = null;

log.info(`Starting WalletShell ${WALLETSHELL_VERSION}`);

//jo let trayIcon = path.join(__dirname,'src/assets/tray.png');
//jo let trayIconHide = path.join(__dirname,'src/assets/trayon.png');

let win;
//jo let tray;

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

    //let contextMenu = Menu.buildFromTemplate([
    //    { label: 'Minimize to tray', click: () => { win.hide(); }},
    //    { label: 'Quit', click: ()=> {
    //            app.needToExit = true;
    //            win.close();
    //        }
    //    }
    //]);

//jo    tray = new Tray(trayIcon);
//jo    tray.setPressedImage(trayIconHide);
//jo    tray.setTitle(config.appName);
//jo    tray.setToolTip(config.appSlogan);
    //tray.setContextMenu(contextMenu);
//jo    tray.on('click', () => {
//jo        if(settings.get('tray_minimize', false)){
//jo            if(win.isVisible()){
//jo                win.hide();
//jo            }else{
//jo                win.show();
//jo            }
//jo        }else{
//jo            if(win.isMinimized()){
//jo                win.restore();
//jo                win.focus();
//jo            }else{
//jo                win.minimize();
//jo            }
//jo        }
//jo        
//jo    });

    win.on('show', () => {
//jo        tray.setHighlightMode('always');
//jo        tray.setImage(trayIcon);
        //contextMenu = Menu.buildFromTemplate([
        //    { label: 'Minimize to tray', click: () => { win.hide();} },
        //    { label: 'Quit', click: ()=> {
        //            app.needToExit = true;
        //            win.close();
        //        }
        //    }
        //]);
        //tray.setContextMenu(contextMenu);
//jo        tray.setToolTip(config.appSlogan);
    });

    win.on('hide', () => {
//jo        tray.setHighlightMode('never');
//jo        tray.setImage(trayIconHide);

        //contextMenu = Menu.buildFromTemplate([
        //        { label: 'Restore', click: () => { win.show();} },
        //        { label: 'Quit', click: ()=> {
        //            app.needToExit = true;
        //            win.close();
        //        }
        //    }
        //]);
        //tray.setContextMenu(contextMenu);
    });

    win.on('minimize', (event) => {
//jo        if(settings.get('tray_minimize')){
//jo            event.preventDefault();
//jo            win.hide();
//jo        }
    });

    //load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'src/html/index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // open devtools
    if(IS_DEV ) win.webContents.openDevTools();

    // show windosw
    win.once('ready-to-show', () => {
        //win.show();
        win.setTitle(`${config.appName} ${config.appDescription}`);
//jo        tray.setToolTip(config.appSlogan);
    });

    win.on('close', (e) => {
//jo        if (!app.needToExit){
//jo        if(settings.get('tray_close') && !app.needToExit){
//            e.preventDefault();
//            win.hide();
//        }else
        if(app.prompExit ){
            e.preventDefault();
            if(app.prompShown) return;
            let msg = 'Are you sure, want to exit?';
            app.prompShown = true;
            dialog.showMessageBox({
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Exit Confirmation',
                message: msg
            }, function (response) {
                app.prompShown = false;
                if (response === 0) {
                    app.prompExit = false;
                    win.webContents.send('cleanup','Clean it up!');
                }else{
                    app.prompExit = true;
                    app.needToExit = false;
                }
            });
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

terminateDaemon = function(force) {

    if(!daemonStatus()) return;
    force = force || false;
    let signal = force ? 'SIGKILL' : 'SIGTERM';

    app.daemonLastPid = app.daemonPid;
    try{
        this.daemonProcess.kill(signal);
        if(app.daemonPid) process.kill(app.daemonPid, signal);
    }catch(e){
      if(!force && this.daemonProcess) {
          log.debug(`SIGKILLing ${config.daemonBinaryFilename}`);
          try{this.daemonProcess.kill('SIGKILL');}catch(err){}
          if(app.daemonPid){
              try{process.kill(app.daemonPid, 'SIGKILL');}catch(err){}
          }
      }
    }

    this.daemonProcess = null;
    app.daemonPid = null;
};

function runDaemon(daemonPath){
    let daemonArgs = [
        '--log-level', 0,
        '--rpc-bind-port', 31875
    ];

    log.debug('Starting daemon...');

    try{
        this.daemonProcess = childDaemonProcess.spawn(daemonPath, daemonArgs);
        app.daemonPid = this.daemonProcess.pid;
    }catch(e){
        log.error(`${config.daemonBinaryFilename} is not running`);
        log.error(e.message);
        return false;
    }
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
    // try to target center pos of primary display
    let eScreen = require('electron').screen;
    let primaryDisp = eScreen.getPrimaryDisplay();
    let tx = Math.ceil((primaryDisp.workAreaSize.width - DEFAULT_SIZE.width)/2);
    let ty = Math.ceil((primaryDisp.workAreaSize.height - (DEFAULT_SIZE.height))/2);
    if(tx > 0 && ty > 0) win.setPosition(parseInt(tx, 10), parseInt(ty,10));

    if (platform === 'darwin') {
      runDaemon(DEFAULT_DAEMON_BIN);
    }
    else {
      runDaemon(settings.get('daemon_bin'));
    }
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

process.on('uncaughtException', function (e) {
    log.error(`Uncaught exception: ${e.message}`);
    process.exit(1);
});

process.on('beforeExit', (code) => {
    log.debug(`beforeExit code: ${code}`);
});

process.on('exit', (code) => {
    terminateDaemon(false);
    log.debug(`exit with code: ${code}`);
});

process.on('warning', (warning) => {
    log.warn(`${warning.code}, ${warning.name}`);
});
