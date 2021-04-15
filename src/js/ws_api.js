"use strict";
const config = require('./ws_config.js');
const log = require('electron-log');
const http = require('http');
const crypto = require('crypto');
const bottleneck = require('bottleneck');

const limiter = new bottleneck({
  maxConcurrent: 5,
  minTime: 1000 
});

// Algo to make sure clock skew doesn't send too many of the same requests out too fast
var timeStamp_Balance = Math.floor(Date.now());
var timeStamp_Height = Math.floor(Date.now());
var timeStamp_Status = Math.floor(Date.now());
var timeStamp_Info = Math.floor(Date.now());

const webTimeout = 45000;
function logDebug(msg) {
  //if(!DEBUG) return;
  console.log(`[api] ${msg}`);
}

var connectionReferenceCount=0;

const getHttpContent = function(pathh, toDaemon, portt, methodd, paramss,
  timeoutt, authoriz, headerss) {

  // return new pending promise
  return new Promise((resolve, reject) => {
    // select http or https module, depending on reqested url
    const lib = require('http'); //url.startsWith('https') ? require('https') : require('http');
    var aurl;
    if (toDaemon) aurl = "http://127.0.0.1:"+portt+"/"+pathh;
    else aurl = "http://127.0.0.1:"+portt+"/json_rpc";

    try {

      // needed to support certain systems that have very poor network latency
      var myAgent = new http.Agent({
        keepAlive: true,
        scheduling: 'fifo',
        timeout: webTimeout
      });

      let optionpath = "/" + pathh;
      if (toDaemon) optionpath = "/" + pathh;
      else optionpath = "/json_rpc";

      let options = {};
      if (authoriz.length > 0) {
        options = {
          jsonrpc: "2.0",
          hostname: '127.0.0.1',
          port: portt,
          path: optionpath,
          method: methodd,
          agent: myAgent,
          timeout: timeoutt,
          headers: headerss,
          authorization: authoriz
        };
      } else {
        options = {
          jsonrpc: "2.0",
          hostname: '127.0.0.1',
          port: portt,
          path: optionpath,
          method: methodd,
          agent: myAgent,
          timeout: timeoutt
        };
      }

      logDebug("aurl: "+aurl);
      logDebug("sending request with options: "+JSON.stringify(options));
      logDebug("and params: "+JSON.stringify(paramss));

      const request = lib.request(aurl, options, (response) => {
        logDebug("response: "+response.statusCode);

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

      if (methodd == "POST") request.write(JSON.stringify(paramss));
      request.end();
    } catch (e) {logDebug("getHttpContent error: "+e);/*do nothing*/ }
  });
};

var curAddr = '';
//var request = require('request-promise-native');
//import { RetryPromiseNative } from 'request-promise-native-retry';

//const axios = require('axios');
//axios.defaults.adapter = require('axios/lib/adapters/http');

class WalletShellApi {
    constructor(args) {
        args = args || {};
        if (!(this instanceof WalletShellApi)) return new WalletShellApi(args);
        this.daemon_host = args.daemon_host || '127.0.0.1';
        this.daemon_port = args.daemon_port;
        this.walletd_host = args.walletd_host || '127.0.0.1';
        this.walletd_port = args.walletd_port || config.walletServiceRpcPort;
        this.walletd_password = args.walletd_password;
        this.minimum_fee = (args.minimum_fee !== undefined) ? args.minimum_fee : 
          (config.minimumFee*config.decimalDivisor);
        this.anonimity = config.defaultMixin;
        this.daemonCoreReady = args.daemonCoreReady || false;
        curAddr = args.address || '';
    }

    setPassword(password) {
        this.walletd_password = password;
    }

    _sendRequest(pathh, todaemon, paramsIn, timeoutIn, needsAuth) {

        logDebug("***** starting _sendRequest: "+pathh);

        return new Promise((resolve, reject) => {
            if (pathh.length === 0) return reject(new Error('Invalid Path'));
            var paramss = paramsIn || {};
            var timeout = timeoutIn || webTimeout;
            var authoriz = "Basic " + Buffer.from("fedadmin:"+this.walletd_password).toString('base64');

            let requestID = 'FED'+crypto.randomBytes(8).toString('hex'); 
            let datum = {
                params: paramss,
                jsonrpc: '2.0',
                id: requestID,
                method: pathh
            };

            // needed to support certain systems that have very poor network latency
            var myAgent = new http.Agent({
                keepAlive: true,
                scheduling: 'fifo',
                timeout: webTimeout 
            });

            let contentLen = Buffer.byteLength(JSON.stringify(datum));
            let headerss = {
                'Connection':'Keep-Alive',
                'Agent':myAgent,
                'request-id': requestID 
            };

            if (needsAuth) {
              headerss = {
                'Connection': 'Keep-Alive',
                'Agent': myAgent,
                'Content-Type': 'application/json',
                'Content-Length': contentLen,
                'authorization': authoriz,
                'request-id': requestID
              };
            }

            let s_type = 'POST'; 
            let theport = this.walletd_port;
            if (todaemon) theport = this.daemon_port;
            if (todaemon) s_type = 'GET';

            if (todaemon) logDebug("to daemon"); else logDebug("to walletd");
            logDebug('***** sending request: '+pathh);

            connectionReferenceCount++;
            logDebug("****************** Into queue ref cnt: "+connectionReferenceCount);

         limiter.schedule(() => 
           getHttpContent(pathh, todaemon, theport, s_type, datum, timeout, authoriz, headerss))
           .then((html) => {
             connectionReferenceCount--;
             let hVal = JSON.parse(html);
             logDebug("_sendRequest data returned: "+JSON.stringify(hVal));
             return resolve(hVal.result);
           }).catch((err) => {
             connectionReferenceCount--;
             logDebug("error in _sendRequest: "+err);
             return reject(err);
           });


/*
            axios(config
                //    {url: s_uri, 
                //method: s_type,
                //headers: {'authorization': authoriz},
                //data: JSON.stringify(datum), 
                //json: true //,
                    //
                //pool: {maxSockets: 1280},
                //timeout: timeout,
                //time: true
  //          }).on('socket', function(socket) {
  //              socket.setTimeout(webTimeout);
 //               socket.on('timeout', function() {
 //                 logDebug("the Socket TIMEDOUT!!!!!!!!!!!!!!!");
  //              });
  //          }).on('timeout', function(e) {
  //              logDebug("TIMEOUT!!!!!!!!!: "+e);
  //          }).on('close', function() {
  //              logDebug("SERVER CONNECTION CLOSED!!!!!!");
  //          }).on('error', function(e) {
  //              // just eat the error, don't throw or stop
  //              let errm = e.toString();
  //              logDebug('error on socket: '+errm);
  //              return reject(errm);
            ).then((res) => {
                //note, this log makes a LOT of chatter when turned on...
                logDebug(`request-respose: ${JSON.stringify(datum)} result: ${JSON.stringify(res)}`);

                if (!res) return resolve(true);
                if (!res.error) {
                    if (res.result) {
                      //logDebug('resolve 1');
                      return resolve(res.result);
                    }
                    //logDebug('resolve 2');
                    return resolve(res);
                } else {
                    // this is not actually an error...
                    if (res.error.message == "Empty object list") {
                      logDebug('empty object list...');
                      return resolve(res);
                    }

                    logDebug("request err msg is: "+res.error.message);
                    return reject(res.error.message);
                }
            }).catch((err) => {
                logDebug(`!!!! sendRequest has FAILED, ${err.message}`);
                return reject(err);
            });
*/
        });
    }

    // used to switch wallet to local daemon once it is fully synced
    bindDaemon(daemonIP, daemonPort) {
        return new Promise((resolve, reject) => {
            if (daemonPort > 0) {
                let req_params = {
                    daemonIP: daemonIP,
                    daemonPort: daemonPort
                };
                this._sendRequest('bindDaemon', false, req_params, 5000, true).then((result) => {
                    return resolve(result);
                }).catch((err) => {
                    return reject(err);
                });
            }
        });
    }
    stopDaemon() {
        return new Promise((resolve, reject) => {
            this._sendRequest('stop_daemon', true, {}, 20000, false).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }

    // only get a single address, no multi address support for this wallet, yet
    getAddress() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getAddresses', false, {}, 15000, true).then((result) => {
                //log.warn("addresses: "+result);
                log.warn("addresses: "+result);
                return resolve(result.addresses[0]);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getFeeInfo() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getFeeInfo', false, {}, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getBalance(params) {
        let newTimeStamp = Math.floor(Date.now());
        if ((newTimeStamp-timeStamp_Balance) < 1000) return;
        timeStamp_Balance = newTimeStamp;

        //logDebug("in api:getBalance: "+JSON.stringify(params));

        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || curAddr;
            let req_params = {
                address: params.address
            };
            this._sendRequest('getBalance', false, req_params, 25000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    save() {
        return new Promise((resolve, reject) => {
            this._sendRequest('save', false, {}, 20000, true).then(() => {
                return resolve();
            }).catch((err) => {
                return reject(err);
           });
        });
    }
    reset(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            let req_params = {};

            // server does not expect a scanHeight at the moment...
            //params.scanHeight = params.scanHeight || 0;
            //if (params.scanHeight && params.scanHeight > 1) {
            //    req_params = { scanHeight: params.scanHeight };
            //}

            params.viewSecretKey = params.viewSecretKey || false;
            if (params.viewSecretKey) {
              //log.warn("reset: secret key supplied... creating new wallet from secret key");
              req_params.viewSecretKey = params.viewSecretKey;
            }

            //log.warn("sending reset to walletd api.");
            this._sendRequest('reset', false, req_params, 10000, true).then(() => {
              //log.warn("sent api reset to walletd...");
              return resolve(true);
            }).catch((err) => {
              return reject(err);
            });
        }).catch((err) => { /* just eat it... connection timeouts are common here */ });
    }
    resume() {
        return new Promise((resolve, reject) => {
           this._sendRequest('resume', false, {}, 10000, true).then((result) => {
               return resolve(result);
           }).catch((err) => {
               resolve("stopped"); // not fatal... the process may have just ended anyway
           });
        });
    }
    getStatus() {
        let newTimeStamp = Math.floor(Date.now());
        if ((newTimeStamp-timeStamp_Status) < 1000) return;
        timeStamp_Status = newTimeStamp;

        return new Promise((resolve, reject) => {
            let req_params = {};
            this._sendRequest('getStatus', false, req_params, 25000, true).then((result) => {
                logDebug("getStatus() got a result");
                return resolve(result);
            }).catch((err) => {
                log.warn("getStatus() got an error! "+err);
                return reject(err);
            });
        });
    }
    getInfo() {
        logDebug("GETINFO!!!!!");
        let newTimeStamp = Math.floor(Date.now());
        if ((newTimeStamp-timeStamp_Info) < 1000) return;
        timeStamp_Info = newTimeStamp;

        return new Promise((resolve, reject) => {
            this._sendRequest('getinfo', true, {}, 10000, false).then((result) => {
                logDebug("GETINFO RETURNED!!!!");
                return resolve(result);
            }).catch((err) => {
                // Just eat any errors...
                //return reject(err);
            });
        });
    }
    getViewKey() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getViewKey', false, {}, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getSpendKeys(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            if (!params.address.length)
                return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };
            this._sendRequest('getSpendKeys', false, req_params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getMnemonicSeed(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            if (params.address.length === 0)
                return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };
            this._sendRequest('getMnemonicSeed', false, req_params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getBackupKeys(params) {
        return new Promise((resolve, reject) => {
            var backupKeys = {};
            params = params || {};
            params.address = params.address || '';
            if (params.address.length === 0) return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };

            this.getViewKey().then((vkres) => {
                backupKeys.viewSecretKey = vkres.viewSecretKey;
                return vkres;
            }).then((vsres) => {
                return this.getSpendKeys(req_params).then((vsres) => {
                  backupKeys.spendSecretKey = vsres.spendSecretKey;
                  return vsres;
                }).catch((err) => { return reject(err); }); 
            }).then(() => {
                //confirm(`viewSecretKey: ${backupKeys.viewSecretKey}`);
                //confirm(`spendSecretKey: ${backupKeys.spendSecretKey}`);
                return resolve(backupKeys);
            }).catch((err) => { return reject(err); });
        
            // this.getMnemonicSeed(req_params).then((mres) => {
            // backupKeys.mnemonicSeed = mres.mnemonicSeed;
        });
    }
    getTransactions(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.firstBlockIndex = params.firstBlockIndex || 1;
            params.blockCount = params.blockCount || 100;
            this._sendRequest('getTransactions', false, params, 20000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    // send single transaction
    sendTransaction(useMixin, params) {
        //log.warn("api sendTransaction, useMixin: "+useMixin);
        let anonLevel = 22;
        if (!useMixin) {
          anonLevel = 0;
        }

        return new Promise((resolve, reject) => {
            params = params || {};
            params.amount = params.amount || false;
            params.address = params.address || false;
            //params.transfers = params.transfers || false;
            params.paymentId = params.paymentId || false;
            params.fee = params.fee || this.minimum_fee;
            if (!params.address) return reject(new Error('Missing recipient address parameter'));
            if (!params.amount) return reject(new Error('Missing transaction amount parameter'));
            if (parseFloat(params.fee) < 0.1) return reject(new Error('Minimum fee is 0.1 FED'));
            //[{address: "FEDxxxx...", amount: 100}];

            var req_params = {};
            if (params.paymentId) {
              req_params = {
                transfers: [{ address: params.address, amount: params.amount }],
                paymentId: params.paymentId,
                anonymity: anonLevel,
                unlockTime: 0,
                fee: params.fee
              };
            } else {
              req_params = {
                transfers: [{ address: params.address, amount: params.amount }],
                anonymity: anonLevel,
                unlockTime: 0,
                fee: params.fee
              };
            }

            //log.warn("sendTransaction: "+JSON.stringify(req_params));
            // give extra long timeout
            this._sendRequest('sendTransaction', false, req_params, 45000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                //log.warn("sendTransaction has FAILED: "+err);
                return reject(err);
            });
        });
    }
    estimateFusion(params) {
        return new Promise((resolve, reject) => {
            params = params || {};

            //log.warn(`estimateFusion params: ${JSON.stringify(params)}`);

            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            this._sendRequest('estimateFusion', false, params, 30000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                //log.warn("estimate fusion has FAILED: "+err); 
                return reject(err);
            });
        });
    }
    sendFusionTransaction(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            if (!params.anonimity) params.anonimity = 0;
            this._sendRequest('sendFusionTransaction', false, params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                //log.warn("send fusion has FAILED: "+err);
                return reject(err);
            });
        });
    }
    createIntegratedAddress(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.address || !params.paymentId) {
                return reject(new Error('Address and Payment Id parameters are required'));
            }
            
            this._sendRequest('createIntegratedAddress', false, params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getHeight() {

      let newTimeStamp = Math.floor(Date.now());
      if ((newTimeStamp-timeStamp_Height) < 1000) return;
      timeStamp_Height= newTimeStamp;

      return new Promise((resolve, reject) => {
        let hVal = {}; 
        let params = {};
        getHttpContent('getheight', true, this.daemon_port, 'GET', params,
           10000, "", {}) 
        .then((html) => {
          logDebug("html: "+html);
          hVal = JSON.parse(html);
          //let datum = html.match(/(?<=:\s*).*?(?=\s*,)/gs);
          //hVal = JSON.parse(datum);
          logDebug("getHeight called in api: "+JSON.stringify(hVal));
          return resolve(hVal);
        }).catch((err) => {logDebug("err in getHeight: "+err);return reject(err)});
      });
    }
}

module.exports = WalletShellApi;
