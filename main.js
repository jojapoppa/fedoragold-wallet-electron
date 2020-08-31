"use strict";
const electron = require('electron');
const app = require('electron').app;
const dialog = require('electron').dialog;
const Tray = require('electron').Tray;
const Menu = require('electron').Menu;
const readable = require('stream').Readable;
const writeable = require('stream').Writeable;
const transform = require('stream').Transform;

const path = require('path');
const vm = require('vm');
const fs = require('fs');
const url = require('url');
const util = require('util');
const http = require('http'); //jojapoppa, do we need both http and https?
const https = require('https');
const websocket = require('websocket-driver');
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
const spawn = require('cross-spawn'); //require('child_process').spawn;
const exec = require('child_process').exec;
const net = require('net');

const udp = require('dgram');
const bencode = require('./src/js/extras/bencode');
const semaphore = require('./src/js/extras/Semaphore.js');
const cjdnsadmin = require('./src/js/extras/cjdnsadmin');

const navigator = require('navigator');
const socksv5 = require('lum_socksv5');
const ssh2Client = require('ssh2').Client;
const ssh2Server = require('ssh2').Server;
const ssh2Utils = require('ssh2').utils;
const inspect = require('util').inspect;
const keypair = require('keypair');
const forge = require('node-forge');
const { autoUpdater } = require("electron-updater");
const { setIntervalAsync } = require('set-interval-async/fixed');

process.env.UV_THREADPOOL_SIZE = 128;

const delayToRunSocks5 = 5000;

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
app.adminPassword=null;
app.socksv5server=null;

app.cjdnsSocketPath=path.join(app.getPath('userData'), 'socks5_server_sock');
app.cjdnsTransform=null;
app.sshClientTransform=null;
app.sshClientStream=null;
app.maxPacketSize=0;

//app.cjdnsProcess=null;
//app.cjdnsArgs=null;
//app.cjdnsPid=null;

app.primarySeedAddr = '18.222.96.134';
app.secondarySeedAddr = '213.136.89.252';
app.primarySeedHeight = 0;

var now = function () { return (new Date()).getTime(); };
var nowSeconds = function () { return Math.floor(now() / 1000); };

var IP6_REGEX = new RegExp('^' + new Array(9).join(':[0-9a-f]{1,4}').substring(1) + '$');
var LABEL_REGEX = new RegExp('^' + new Array(5).join('.[0-9a-f]{4}').substring(1) + '$');
var ADDR_REGEX = new RegExp('^v[0-9]+' + new Array(5).join('\\.[0-9a-f]{4}') + '\\.[a-z0-9]{52}\\.k$');
var validTarget = function (target) {
    if (IP6_REGEX.test(target)) { return true; }
    if (LABEL_REGEX.test(target)) { return true; }
    if (ADDR_REGEX.test(target)) { return true; }
    return false;
};

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

function createWindow() {

    // Create the browser window.
    let darkmode = settings.get('darkmode', true);
    let bgColor = darkmode ? '#000000' : '#FFCC33';   // '#FFCC33'; //jojapoppa

    // webPreferences: { ... devTools:true
    const winOpts = {
        title: `${config.appName} ${config.appDescription}`,
        icon: path.join(__dirname,'src/assets/walletshell_icon.png'),
        frame: true,
     
        webPreferences: {
          enableRemoteModule: true,
          nodeIntegration: true,
          nodeIntegrationInWorker: true },
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
        }
    });

    // Tried embedding ..Version ${versionInfo.version} has been.. in the text, but the version # doesn't display
    //   so, I gave up and just made the message generic...
    win.on('show', () => {
      autoUpdater.autoDownload = true;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.logger = log;
      autoUpdater.logger.transports.file.level = "info";
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        log.warn('Error on update (NAME_NOT_RESOLVED is old yml on github): ',err);
      });

      autoUpdater.on('update-downloaded', (versionInfo) => {
        var dialogOptions = {
          type: 'question',
          defaultId: 0,
          title: 'FED Update Downloaded and Ready for Install',
          message: 'A FedoraGold (FED) update is ready to install, the update has been downloaded and will be automatically installed when you click OK.'
        };
        dialog.showMessageBox(win, dialogOptions, function() {
          ensureSafeQuitAndInstall();
          // https://www.electron.build/auto-update
          if (process.env.DESKTOPINTEGRATION === 'AppImageLauncher') {
            // remap temporary running AppImage to actual source
            autoUpdater.on.logger.info('rewriting $APPIMAGE', {
              oldValue: process.env.APPIMAGE,
              newValue: process.env.ARGV0,
            });
            process.env.APPIMAGE = process.env.ARGV0;
          } else {
            autoUpdater.on.logger.info('Not running in AppImageLauncher...')
          }

          autoUpdater.quitAndInstall();
        });
      });
    });

    win.on('hide', () => {});
    win.on('minimize', (event) => {});

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'src/html/index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // open devtools - DEBUG
    //if(IS_DEV && (win!==null))
    //win.webContents.openDevTools();

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
      response.on('data', (chnk) => body.push(chnk));
      // we are done, resolve promise with those joined chunks
      response.on('end', () => resolve(body.join('')));
    });
    // handle connection errors of the request
    request.on('error', (err) => reject(err));
  });
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

/*
function getConn(connName, porto) {

  try {

    var option = {
        host:'localhost',
        port: porto
    }

    // Create TCP client.
    var hclient = net.createConnection(option, function () {
        log.warn('Connection name : ' + connName);
        log.warn('Connection local address : ' + hclient.localAddress + ":" + hclient.localPort);
        log.warn('Connection remote address : ' + hclient.remoteAddress + ":" + hclient.remotePort);
    });

    hclient.setTimeout(1000);
    hclient.setEncoding('utf8');

    // When receive server send back data.
    hclient.on('data', function (datr) {
        log.warn('getConn return data : ' + datr);
        logDataStream(datr);
    });

    // When connection disconnected.
    hclient.on('end',function () {
        log.warn('Client socket disconnect. ');
    });

    hclient.on('timeout', function () {
        log.warn('Client connection timeout. ');
    });

    hclient.on('error', function (err) {
        log.warn(JSON.stringify(err));
    });

  } catch (e) {
    log.warn(`Failed to connect to cjdns socket: ${e.message}`);
  }

  return hclient;
}
*/

/*
var writeSocket = function (sock, addr, port, pass, buff, callback) {
    var cookieTxid = String(sock.counter++);
    var cookieMsg = Buffer.from(bencode.encode({'q':'cookie','txid':cookieTxid}));

    sock.send(buff, 0, buff.length, port, addr, callback);

//        function(err, bytes) {
//        log.warn("cookie sent");
//        if (err) { callback(err); return; }
//        var cookie = ret.cookie;
//        if (typeof(cookie) !== 'string') { throw new Error("invalid cookie in [" + ret + "]"); }
//        var json = {
//            txid: String(sock.counter++),
//            q: buff
//            //args: {}
//        };
//        Object.keys(args).forEach(function (arg) {
//            json.args[arg] = args[arg];
//        });
//        if (pass) {
//            json.aq = json.q;
//            json.q = 'auth';
//
//            json.cookie = cookie;
//            json.hash = Crypto.createHash('sha256').update(pass + cookie).digest('hex');
//            json.hash = Crypto.createHash('sha256').update(Bencode.encode(json)).digest('hex');
//        }
};
*/

function toArrayBufferInt32 (num) {
  let arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
  let view = new DataView(arr);
  view.setUint32(0, num, false); // byteOffset = 0; litteEndian = false
  return arr;
}

function toIntFrom4Bytes (b1,b2,b3,b4) {
  let arr = new Uint8Array([b1,b2,b3,b4]);
  let u32bytes = arr.buffer.slice(-4);
  return new Uint32Array(u32bytes)[0];
}

function toHexIPv6String(bytes) {

  let output = "";
  for (let i=0; i < (bytes.length-1); i+=2) {
    output += (bytes[i] & 0xFF).toString(16);
    output += (bytes[i+1] & 0xFF).toString(16);
    output += ":"
  }

  return output;
} 

function connectSSHClientToCjdnsSocket(remotePeerIP, remotePeerPort) {

  let sshClientConn = new ssh2Client();
  log.warn("new sshClient created for forward");

  /*sshClientConn.on('ready', function() {
    log.warn('cjdns ssh client :: ready');
    sshClientConn.forwardOut(remotePeerIP, remotePeerPort, '127.0.0.1', 1080, function(err, stream) {
      app.sshClientStream = stream;
      log.warn('app.sshClientStream assigned ... ready.');
      if (err) throw err;
      stream.on('close', function() {
        log.warn('CJDNS :: CLOSED');
        sshClientConn.end();
      });
    });
  });*/

  sshClientConn.connect({
    host: remotePeerIP,
    port: remotePeerPort,
    tryKeyboard: true,
    debug: console.log,
    readyTimeout: 99999,
    sock: app.sshClientTransform,
    username: 'nodejs',
    password: 'rocks'
  });
}

var socksstarted = false;
function connectSocks5ServerAndSSHClientToCjdnsSocket() {

//  var ssh_config = { 
//    host: 'fc5f:c4d1:d35f:5663:d94f:22c5:c1c4:4bc8',
//    port: 22,
//    username: 'nodejs',
//    password: 'rocks',
// //   sock: app.cjdnsTransform
//  };

  log.warn("launching socks5 proxy with connection to socket");

  app.socksv5server = socksv5.createServer(function(info, accept, deny) {
    log.warn("socksv5 got a client connection request");

    let socksv5ClientSocket = accept(true);
    if (socksv5ClientSocket) {
      log.warn("got a socksv5client socket");
    }

    // NOTE: you could just use one ssh2 client connection for all forwards, but
    // you could run into server-imposed limits if you have too many forwards open
    // at any given time
    
    connectSSHClientToCjdnsSocket('fce4:48e5:10cc:9c69:53f9:127d:8008:5b00', 22);

    /* 
    var sshClientConn = new ssh2Client();
    log.warn("new sshClient created for forward");

    try {
      sshClientConn.on('ready', function() {
        log.warn("ssh client: in ready() setting up forwarding...");
        sshClientConn.forwardOut(info.srcAddr, info.srcPort, info.dstAddr, info.dstPort, function(err, stream) {
          log.warn("attempting to forward a connection now...");
          if (err) {
            sshClientConn.end();
            socksstarted = false;
            log.warn("err in forward: "+err);
            return deny();
          }

          log.warn("setup of tcp socket for client connection (routes through cjdns)");
          var clientSocket = accept(true);
          if (clientSocket) {
            stream.pipe(clientSocket).pipe(stream).on('close', function() {
              sshClientConn.end();
            });
          } else
            sshClientConn.end();

          log.warn("ssh client is ready...");
        });
      }).on('error', function(err) {
        log.warn("error in ssh client connection: "+err);
        socksstarted = false;
        deny();
      }).connect(ssh_config);
    } catch(e) {
      socksstarted = false;
      log.warn("error creating ssh client: "+e);
    }
*/
  }).listen(1080, '0.0.0.0', function() {
    log.warn('FedoraGold SOCKSv5 proxy server started on port 1080');
  }).useAuth(socksv5.auth.None());

/*
  app.socksv5server.on('connection', function(info, accept, deny) {
    log.warn("connection request with socksv5 server");
    log.warn("info: srcad:%j srcpt:%j destad:%j destpt:%j",info.srcAddr, info.srcPort, info.dstAddr, info.dstPort);

    let socksv5ClientSocket = accept(true);
    if (socksv5ClientSocket) {
      log.warn("got a socksv5client socket");

      /*
      if (app.cjdnsTransform === null)
        log.warn("cjdns socket is null"); 
      else {

        app.cjdnsTransform.pipe(socksv5ClientSocket).pipe(app.cjdnsTransform).on('close', function() {
          log.warn("close socksv5 connection"); 
          socksv5ClientSocket.end();
        });

        //app.cjdnsTransform.write('TEST');
      }
    }
  });
*/
}

var exitnodestarted = false;
function connectSSHExitNodeToSocket() {
  var utils = ssh2Utils;
  log.warn("in connectExitNodeToSocket() !!");

  var allowedUser = Buffer.from('nodejs');
  var allowedPassword = Buffer.from('rocks');

  var pair = keypair();
  var allowedPubKey = forge.pki.publicKeyFromPem(pair.public);
  var privKey = pair.private;
  //var ssh = forge.ssh.publicKeyToOpenSSH(publicKey, 'user@domain.tld');

  //log.warn('generated public key: %j',allowedPubKey);
  //log.warn("generated private key: "+privKey);

  new ssh2Server({
    hostKeys: [privKey],
    username: 'nodejs',
    password: 'rocks',
    port: 22,
    sock: app.cjdnsTransform
  }, function(client) {
    log.warn('an ssh client has connected to server!!!!!!!!!!!!!!!!');
 
    client.on('authentication', function(ctx) {
      log.warn("ssh server will authenticate client now");

      var user = Buffer.from(ctx.username);
      if (user.length !== allowedUser.length
          || !crypto.timingSafeEqual(user, allowedUser)) {
        return ctx.reject();
      }
 
      switch (ctx.method) {
        case 'password':
          log.warn("check password");
          var password = Buffer.from(ctx.password);
          if (password.length !== allowedPassword.length
              || !crypto.timingSafeEqual(password, allowedPassword)) {
            log.warn("client password failure");
            return ctx.reject();
          }
          break;
        case 'publickey':
          log.warn("check public key...");
          var allowedPubSSHKey = allowedPubKey.getPublicSSH();
          if (ctx.key.algo !== allowedPubKey.type
              || ctx.key.data.length !== allowedPubSSHKey.length
              || !crypto.timingSafeEqual(ctx.key.data, allowedPubSSHKey)
              || (ctx.signature && allowedPubKey.verify(ctx.blob, ctx.signature) !== true)) {
            log.warn("client publickey failure");
            return ctx.reject();
          }
          break;
        default:
          return ctx.reject();
      }
 
      ctx.accept();
    }).on('ready', function() {
      log.warn('Client authenticated!');

      /*client.on('session', function(accept, reject) {
        var session = accept();
        session.once('exec', function(accept, reject, info) {
          log.warn('Client wants to execute: ' + inspect(info.command));
          var stream = accept();
          stream.stderr.write('Oh no, the dreaded errors!\n');
          stream.write('Just kidding about the errors!\n');
          stream.exit(0);
          stream.end();
        });
      });*/

      client.on('tcpip', function(accept, reject) {
        log.warn("the ssh client has requested an outbound tcp connection.");
      });

    }).on('end', function() {
      log.warn('Client disconnected');
    });
  }).listen(function() {
    log.warn('Exit node listening on: '+app.cjdnsSocketPath);
  });
}

function promisifyAll(obj) {
    for (let k in obj) {
        if (typeof obj[k] === 'function') {
            //log.warn("function: "+obj[k]);
            obj[k] = util.promisify(obj[k]);
        }
    }
}

async function pageFunctionList(cjdns, waitFor, page) {
  cjdns.Admin_availableFunctions(page, waitFor(function (err, ret) {
    if (err) { log.warn("functions: "+err.message); throw err; }
    Object.keys(ret.availableFunctions).forEach(function(nm){log.warn("name: "+nm);});
    //log.warn("objkeys more: %j", Object.keys(ret));
    if (Number(ret.more) > 0) { pageFunctionList(cjdns, waitFor, page+1); }
  }));

  log.warn("page %d", (page+1));
}

app.sshClientTransform = new transform({objectMode: false});
app.sshClientTransform._transform = function(data, encoding, callback) {
  log.warn("ssh client transform function: ");
  logDataStream(data);
  
  let buf = null;
  let i = 0; 

  while (i < data.length) {
    buf = Buffer.from(data, i);
    let endloc = buf.indexOf('CJD');
    if (endloc == 0) {
      log.warn("CJDNS info recieved, sending to SSH client");
      
      let packetSize = toIntFrom4Bytes(data[i+6],data[i+5],data[i+4],data[i+3]);
      if ((app.maxPacketSize > 0) && (packetSize > app.maxPacketSize))
        packetSize = app.maxPacketSize;
      log.warn("cjdns packet size: "+packetSize);
      log.warn("data length is: "+data.length);
      i += 7;

      if (packetSize > 0) {
        log.warn("process packet now with size: "+packetSize);
        buf = Buffer.from(data, i, packetSize);
        i += packetSize;
        this.push(buf);
      }
    } else {
      log.warn("sending ssh client info to cjdns");
      let tag = Buffer.from('SSH');
      if (endloc > 0) buf = Buffer.from(data, i, endloc-i-1);
      let outp = Buffer.concat([tag, buf, tag]);
      if (app.cjdnsTransform !== null) app.cjdnsTransform.write(outp);
      i += buf.length;
    }
  }

  if (i < data.length) {
    log.warn("ssh data leftover: need unshift logic");
  } 

  log.warn("ssh client transform done");
  callback();
};

app.cjdnsTransform = new transform({objectMode: false});
app.cjdnsTransform._transform = function(data, encoding, callback) {
  log.warn("cjdns transform function: ");
  logDataStream(data);
  let i = 0; 

  while (i < data.length) {
    let buf = Buffer.from(data, i, data.length);
    switch (data[i]) {
      case 0: {
        log.warn("TYPE_TUN_PACKET");
        let packetSize = toIntFrom4Bytes(data[i+4],data[i+3],data[i+2],data[i+1]);
        if ((app.maxPacketSize > 0) && (packetSize > app.maxPacketSize))
          packetSize = app.maxPacketSize;
        log.warn("cjdns packet size: "+packetSize);
        log.warn("data length is: "+data.length);
        i += 5;
        if (data.length < packetSize) {
          log.warn("process truncated packet now with size: "+data.length);
          i += buf.length;
        } else if (packetSize > 0) {
          log.warn("process packet now with size: "+packetSize);
          buf = Buffer.from(data, i, packetSize);
          i += packetSize;
        }

        let tag = Buffer.from('CJD');
        let b2 = Buffer.from(toArrayBufferInt32(packetSize), 0, 4);
        if (app.sshClientTransform !== null) app.sshClientTransform.write(Buffer.concat([tag, b2, buf])); 
        break;
      }
      case 1: {
        log.warn("TYPE_CONF_ADD_IPV6_ADDRESS");
        let iv6 = toHexIPv6String([data[i+1],data[i+2],data[i+3],data[i+4],data[i+5],data[i+6],
          data[i+7],data[i+8],data[i+9],data[i+10],data[i+11],data[i+12],data[i+13],data[i+14],
          data[i+15],data[i+16]]);
        log.warn("my cjdns source ipv6 address: "+iv6);
        i += 17;
        break;
      }
      case 2: {
        log.warn("TYPE_CONF_SET_MTU");
        app.maxPacketSize = toIntFrom4Bytes(data[i+4],data[i+3],data[i+2],data[i+1]);
        log.warn("cjdns MTU (max packet size): "+app.maxPacketSize);
        i += 5;
        break;
      }
      default: {
        let endloc = buf.indexOf('SSH');
        if (endloc == 0) {
          log.warn("Cjdns transform: incoming from ssh");
  
          buf = Buffer.from(data, i+3);
          let len = buf.indexOf('SSH'); //, 'utf8');
          if (len == -1) len = buf.length;
  
          let b1 = Buffer.from([0], 0, 1);
          let b2 = Buffer.from(toArrayBufferInt32(len), 0, 4);
          let b3 = Buffer.from(buf, 0, len);
          buf = Buffer.concat([b1, b2, b3]);
          this.push(buf);
          logDataStream(buf);
          log.warn("data sent to cjdns");
          i += b3.length+6;
          break;
        } else {
          log.warn("Unrecognized CJDNS data.");
          i++;
        } 
      }
    }
  }

  if (i < data.length) {
    log.warn("cjdns data leftover: need unshift logic");
  }

  log.warn("cjdns transform done");
  callback();
};

var connections = {};
function createDomainSocketServerToCjdns(socketPath){
    log.warn('Creating domain socket server.');
    var server = net.createServer(function(stream) {
      log.warn('Connection acknowledged, now assign cjdns socket next...');

      var driver = websocket.client('ws://www.example.com/socket:8080');

// next use ping on the driver.io to prove connection and route that into transform after

//      stream.pipe(app.cjdnsTransform).pipe(stream);
//      app.cjdnsTransform.pipe(driver.io).pipe(app.cjdnsTransform);

      log.warn('********* cjdns domain socket to cjdns connected **********');

      // Store all connections so we can terminate them if the server closes.
      // An object is better than an array for these.
      var self = Date.now();
      connections[self] = (stream);

      stream.on('connect', ()=>{
        driver.start();
        log.warn("cjdns stream connect event recieved **************");
      });

      stream.on('end', function() {
        log.warn('Client disconnected.');
        delete connections[self];
      });

      //stream.on('readable', function () {
      //  let data = stream.read();
      //  log.warn("starting readable stream from cjdns");
      //  //logDataStream(data);
      //  //stream.write(data); // or translate it if you want...
      //});

      stream.on('error', function(data) {
        log.warn('domainSocket error: '+data);
      });

      //stream.pipe(stream); // send the data on its way...
    })
    .listen(socketPath)
    //.on('connection', function(socket){
    //  app.cjdnsTransform = socket;
    //  log.warn('********* cjdns domain socket to cjdns connected **********');
    //  //socket.write('__boop');
    //  //console.log(Object.keys(socket));
    //})
    .on('error', (err) => {
      log.warn("error creating cjdns domain socket: "+err);
    });

    return server;
}

/*
THIS CODE ALLOWS YOU TO ACCESS THE ADMIN PORT ON CJDNS 
  log.warn("createReadableCjdnsStream()... with admin password: "+app.adminPassword);

  //jojapoppa: need to parameterize this stuff...
  let target = 'fc49:1b98:5322:be12:d324:f52a:a33c:e6b2';
  let adminPort = 11234;

  let cjdns;
  if (app.adminPassword != null)
    try {
      nThen(function (waitFor) {
        log.warn("call connect...");
        cjdnsadmin.connect('127.0.0.1', adminPort, app.adminPassword, waitFor(function (c) { cjdns = c; }));

        if (!validTarget(target)) {
            Dns.lookup(target, 6, waitFor(function (err, res) {
                if (err) { log.warn(err.message); throw err; }
                console.log(target + ' has ip address ' + res);
                target = res;
            }));
        }
      }).nThen(function (waitFor) {
        log.warn("getting functions list...");
        pageFunctionList(cjdns, waitFor, 0);
      }).nThen(function (waitFor) {
        log.warn("function list completed.");
      });

//        udpSocket.on("data", function(datr) {
//          log.warn("data in on udp: "+datr.toString());
//          // pack incoming data into the buffer
//          //buffer = Buffer.concat([buffer, Buffer.from(datr, 'hex')]);
//        });

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

//      cjdnsniff.sniffTraffic(cjdns, 'CTRL', (err, ev) => {
//        if (!ev) { log.warn("error connecting to hyperboria"); throw err; }
//        ev.on('error', (e) => { log.warn(e); });
//
//        ev.on('message', (msg) => {
//            //::msg = (msg:Cjdnsniff_CtrlMsg_t);*
//            const pr = [];
//            pr.push(msg.routeHeader.isIncoming ? '>' : '<');
//            pr.push(msg.routeHeader.switchHeader.label);
//            pr.push(msg.content.type);
//            if (msg.content.type === 'ERROR') {
//                const content = (msg.content); //:Cjdnsctrl_ErrMsg_t
//                pr.push(content.errType);
//                log.warn(content.switchHeader);
//                if (content.switchHeader) {
//                    pr.push('label_at_err_node:', content.switchHeader.label);
//                }
//                if (content.nonce) {
//                    pr.push('nonce:', content.nonce);
//                }
//                pr.push(content.additional.toString('hex'));
//            } else {
//                const content = (msg.content); // :Cjdnsctrl_Ping_t
//                if (content.type in ['PING', 'PONG']) {
//                    pr.push('v' + content.version);
//                }
//                if (content.type in ['KEYPING', 'KEYPONG']) {
//                    pr.push(content.key);
//                }
//            }
//            log.warn(pr.join(' '));
//        });
//      }); 

    } catch(e) {
      log.warn("error in udp connection: "+e.message);
    }
}
*/

setTimeout(function runSocks5Proxy() {
  log.warn("runSocks5Proxy with socket: "+app.cjdnsSocketPath);

  if (!socksstarted) {
    socksstarted = true;
    try {
      createDomainSocketServerToCjdns(app.cjdnsSocketPath);
      setTimeout(connectSocks5ServerAndSSHClientToCjdnsSocket, 500);
//      setTimeout(connectSSHExitNodeToSocket, 1000);
    } catch(e) {
      socksstarted = false;
      log.warn("error connecting socks5 to cjdns socket: "+e.message);
      return false;
    }
  }
  return true;
}, delayToRunSocks5);

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
            if (win!==undefined&&win!==null) win.webContents.send('console', errmsg);
            log.warn("killing the daemon!!");
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
          //log.warn(procStr);
          log.warn("runDaemon()...");
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
          log.warn("restart the daemon due to inactivity..."); 
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

            res.on('data', (chnk) => {
                result += chnk;
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

electron.dialog.showErrorBox = (title, content) => {
  log.warn(`${title}\n${content}`);
};

process.on('unhandledRejection', function(err) {});
function terminateDaemon() {

    app.daemonLastPid = app.daemonPid;
    try{
      if (app.daemonProcess !== null) {

        // this offers clean exit on all platforms
        log.warn("exit command sent to fedoragold_daemon"); 
        app.daemonProcess.stdin.write("exit\n");
        app.daemonProcess.stdin.end();
      }
    }catch(e){/*eat any errors, no reporting nor recovery needed...*/}
}

function runDaemon() {

    // if there are insufficient resources, just run the daemon in thin mode 
    if (! checkMemoryAndStorage()) {
      log.warn("insufficient resources to run local daemon, will use remote instead");
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
      '--rpc-bind-ip', '0.0.0.0',
      '--rpc-bind-port', settings.get('daemon_port'),
      '--add-priority-node', '18.222.96.134:30158', 
      '--add-priority-node', '213.136.89.252:30158'
    ];

    // unable to get this mode working yet, but seems to work for Meroex!
    app.integratedDaemon = false;
    app.chunkBuf = "\n ********Running Daemon from main.js ***********\n";
    var newTimeStamp;

    try {
        // daemon must run detached, otherwise windows will not exit cleanly
        if (! app.integratedDaemon) { 
          app.daemonProcess = spawn(daemonPath, daemonArgs, 
            {detached: true, stdio: ['ignore','pipe','pipe'], encoding: 'utf-8'});
          app.daemonPid = app.daemonProcess.pid;
        }

        app.daemonProcess.stdout.on('data', function(chnk) {
          // limit to 1 msg every 1/4 second to avoid overwhelming message bus
          app.chunkBuf += chnk;
          newTimeStamp = Math.floor(Date.now());
          if ((win !== null) && ((newTimeStamp-app.timeStamp) > 2500)) {
            app.timeStamp = newTimeStamp;
            win.webContents.send('console', app.chunkBuf);
            app.chunkBuf = '';
          }
        });
        app.daemonProcess.stderr.on('data', function(chnk) {
          log.warn("fedoragold_daemon error: "+chnk);
          if (win!==null) win.webContents.send('console',chnk);
        });
    } catch(e) {
      log.error("runDaemon: "+e.message);
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

function sendConsoleThinMsg() {
  if (win!==null) {
    let text = "thin mode...\nInsufficient memory or storage to run a local daemon.\n";
    text = text+"Wallet will therefore run with remote daemons.\n...\n";
    //log.warn(text);
    win.webContents.send('console', text);
  }
}

function checkMemoryAndStorage() {

  let gbStorageAvailable = 26;
  let locat = '/';
  if (platform === 'win32') locat = 'C:/';

  // Check storage later ... not yet critical
  //log.warn("checkMemoryAndStorage()");

  let gbMemoryAvailable = (opsys.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
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
log.warn("createWindow()");
    createWindow();
log.warn("window bounds");

    var bounds = win.webContents.getOwnerBrowserWindow().getBounds();
    let tx = Math.ceil((bounds.width - DEFAULT_SIZE.width)/2);
    let ty = Math.ceil((bounds.height - (DEFAULT_SIZE.height))/2);
    if(tx > 0 && ty > 0) win.setPosition(parseInt(tx, 10), parseInt(ty,10));

log.warn('set timeout to run daemon...');

    // run in directly the 1st time so that it boots up quickly - not too fast on OSX
    setTimeout(function(){ runDaemon(); }, 1000);
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
    //process.exit(1);
});

process.on('beforeExit', (code) => {
    log.debug(`beforeExit code: ${code}`);
});

process.on('exit', (code) => {
    terminateDaemon();
});

//    // needs it twice for some reason on an application exit... unreliable otherwise...
//    try{
//      if (app.daemonProcess !== null) {
//        // this offers clean exit on all platforms
//        app.daemonProcess.stdin.write("exit\n");
//        app.daemonProcess.stdin.end();
//        //log.warn("exit command sent to fedoragold_daemon");
//      }
//    }catch(e){/*eat any errors, no reporting nor recovery needed...*/}

process.on('warning', (warning) => {
    log.warn(`${warning.code}, ${warning.name}`);
});
