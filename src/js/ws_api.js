"use strict";

class WalletShellApi {

    constructor(args) {
        args = args || {};
        if (!(this instanceof WalletShellApi)) return new WalletShellApi(args);

        this.config = require('./ws_config.js');
        this.log = require('electron-log');
        this.http = require('http');
        this.randomBytes = require('randombytes');
        this.bottleneck = require('bottleneck');

        this.daemon_host = args.daemon_host || '127.0.0.1';
        this.daemon_port = args.daemon_port;
        this.walletd_host = args.walletd_host || '127.0.0.1';
        this.walletd_port = args.walletd_port || this.config.walletServiceRpcPort;
        this.walletd_password = args.walletd_password;
        this.minimum_fee = (args.minimum_fee !== undefined) ? args.minimum_fee : 
          (this.config.minimumFee*this.config.decimalDivisor);
        this.anonimity = this.config.defaultMixin;
        this.daemonCoreReady = args.daemonCoreReady || false;
        this.curAddr = args.address || '';

        this.limiter = new this.bottleneck({
          maxConcurrent: 4,
          minTime: 333
        });

        // Algo to make sure clock skew doesn't send too many of the same requests out too fast
        this.timeStamp_Balance = Math.floor(Date.now());
        this.timeStamp_Height = Math.floor(Date.now());
        this.timeStamp_Status = Math.floor(Date.now());
        this.timeStamp_Info = Math.floor(Date.now());

        this.webTimeout = 45000;
        this.connectionReferenceCount=0;
        this.walletdRunning = false;
        this.daemonIsRunning = false;
    }

    logDebugMsg(msg) {
      //if(!DEBUG) return;
      console.log(`[api] ${msg}`);
    }

    getHttpContent(pathh, toDaemon, portt, methodd, paramss,
      timeoutt, needAuthoriz, authoriz, headerss) {

      // return new pending promise
      return new Promise((resolve, reject) => {

        if (!this.walletdRunning) return reject(new Error("walletd not yet started"));
        //this.logDebugMsg("getHttpContent: "+pathh);

        // select http or https module, depending on reqested url
        const lib = require('http');
        var aurl;
        if (toDaemon) aurl = "http://127.0.0.1:"+portt+"/"+pathh;
        else aurl = "http://127.0.0.1:"+portt+"/json_rpc";
 
        try {
          let optionpath = "/" + pathh;
          if (!toDaemon) optionpath = "/json_rpc";

          //this.logDebugMsg("optionpath is: "+optionpath);

          // needed to support certain systems that have very poor network latency
          var myAgent = new this.http.Agent({
            keepAlive: true,
            scheduling: 'fifo',
            path: optionpath,
            timeout: this.webTimeout,
          });

          let options = {};
          if (needAuthoriz) {
            options = {
              jsonrpc: '2.0',
              host: '127.0.0.1',
              port: portt,
              path: optionpath,
              method: methodd,
              timeout: timeoutt,
              headers: headerss
              //agent: myAgent
            };
          } else {
            options = {
              url: aurl,
              jsonrpc: '2.0',
              port: portt,
              path: optionpath,
              method: methodd,
              agent: myAgent,
              timeout: timeoutt
            };
          }
 
          //this.logDebugMsg("START**********************");
          //this.logDebugMsg("aurl: "+aurl);
          //this.logDebugMsg("options: "+JSON.stringify(options));
          //this.logDebugMsg("**");

          try {
            const request = lib.request(options, (response) => {

              //this.logDebugMsg("got a http.request response...");

              // handle http errors
              if (response.statusCode < 200 || response.statusCode > 299) {
                return reject(new Error('Failed to load page, status code: ' + response.statusCode));
              }
              // temporary data holder
              const body = [];
              // on every content chunk, push it to the data array
              response.on('data', (chnk) => body.push(chnk));
              // we are done, resolve promise with those joined chunks
              response.on('end', () => {return resolve(body.join(''));});
            });
 
            // handle connection errors of the request
            request.on('error', (err) => {request.destroy();return reject(new Error("http err: "+err));});
 
            if (methodd == "POST") {
              //this.logDebugMsg("POST paramss/datum: "+JSON.stringify(paramss));
              //this.logDebugMsg("END************************");
              request.write(JSON.stringify(paramss));
            }

            request.end();
          } catch(e){return reject(new Error("Http2 connect error: "+e));}
        } catch (e) {return reject(new Error("getHttpContent error: "+e));}
      });
    }

    setPassword(password) {
        this.walletd_password = password;
    }

    _sendRequest(pathh, pri, todaemon, paramsIn, timeoutIn, needsAuth) {

        return new Promise((resolve, reject) => {

            if (!this.walletdRunning) return reject(new Error("walletd not yet started"));
            //this.logDebugMsg("***** starting _sendRequest: "+pathh);

            if (pathh.length === 0) return reject(new Error('Invalid Path'));

            var timeout = timeoutIn || this.webTimeout;
            var authoriz = "Basic " + Buffer.from("fedadmin:"+this.walletd_password).toString('base64');

            //this.logDebugMsg("basic auth: "+authoriz);

            let requestID = 'FED'+this.randomBytes(8).toString('hex'); 
            let datum = {
                params: paramsIn,
                jsonrpc: '2.0',
                id: requestID,
                method: pathh
            };

            // don't send params if it's empty...
            if (Object.keys(paramsIn).length === 0) {
              datum = {
                jsonrpc: '2.0',
                id: requestID,
                method: pathh
              };
            }

            //this.logDebugMsg("_sendRequest datum: "+JSON.stringify(datum));
            let contentLen = Buffer.byteLength(JSON.stringify(datum));

            // needed to support certain systems that have very poor network latency
            var myAgent = new this.http.Agent({
                keepAlive: true,
                scheduling: 'fifo',
                timeout: this.webTimeout,
                path: pathh
            });

            let headerss = {
                'Connection':'Keep-Alive',
                'Agent':myAgent,
                'request-id': requestID 
            };

            if (needsAuth) {
              headerss = {
                'Connection': 'Keep-Alive',
                'Content-Type': 'application/json',
                'Content-Length': contentLen,
                'authorization': authoriz,
                'request-id': requestID
              };
            }

            //this.logDebugMsg("contentLen: "+contentLen);
            //this.logDebugMsg("authoriz: "+authoriz);

            let s_type = 'POST'; 
            let theport = this.walletd_port;
            if (todaemon) {
              theport = this.daemon_port;
              s_type = 'GET';
            }

            //if (todaemon) this.logDebugMsg("to daemon"); else this.logDebugMsg("to walletd");
            //this.logDebugMsg('***** sending request: '+pathh);

            this.connectionReferenceCount++;
            //this.logDebugMsg("****************** Into queue ref cnt: "+this.connectionReferenceCount);

           var job = {
             priority: pri,
             weight: 1,
             expiration: 30000,
             id: requestID
           };

           this.limiter.schedule(() => {job,
             this.getHttpContent(pathh, todaemon, theport, s_type, datum, timeout, needsAuth,
               authoriz, headerss)
             .then((html) => {
               this.connectionReferenceCount--;
               let hVal = JSON.parse(html);
               //this.logDebugMsg("_sendRequest data returned: "+JSON.stringify(hVal));
               return resolve(hVal);
             }).catch((err) => {
               this.connectionReferenceCount--;
               return reject(new Error("error in _sendRequest: "+err));
             });
           }).catch((err) => {return reject(new Error("limiter err: "+err))});
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
                this._sendRequest('bindDaemon', 9, false, req_params, 5000, true).then((result) => {
                    return resolve(result);
                }).catch((err) => {
                    return reject(new Error("bind err: "+err));
                });
            }
        });
    }

    // only get a single address, no multi address support for this wallet, yet
    getAddress() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getAddresses', 7, false, {}, 15000, true).then((rslt) => {
                if (rslt.result !== undefined)
                  return resolve(rslt.result.addresses[0]);
                else
                  return reject(new Error("no address result"));
            }).catch((err) => {
                return reject(new Error("addr err: "+err));
            });
        });
    }
    getFeeInfo() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getFeeInfo', 6, false, {}, 10000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return reject(new Error("no fee result"));
            }).catch((err) => {
                return reject(new Error("feeinfo err: "+err));
            });
        });
    }
    getBalance(params) {
        return new Promise((resolve, reject) => {

            let newTimeStamp = Math.floor(Date.now());
            if ((newTimeStamp-this.timeStamp_Balance) < 1000) reject(new Error("insuffient elapsed time"));
            this.timeStamp_Balance = newTimeStamp;

            params = params || {};
            params.address = params.address || this.curAddr;
            let req_params = {
                address: params.address
            };

            //this.logDebugMsg("getBalance addr: "+JSON.stringify(params));

            this._sendRequest('getBalance', 5, false, req_params, 25000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(new Error("balance err: "+err));
            });
        });
    }
    save() {
        return new Promise((resolve, reject) => {
            this._sendRequest('save', 9, false, {}, 20000, true).then(() => {
                return resolve();
            }).catch((err) => {
                return reject(new Error("save err: "+err));
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
              //logDebugMsg("reset: secret key supplied... creating new wallet from secret key");
              req_params.viewSecretKey = params.viewSecretKey;
            }

            //logDebugMsg("sending reset to walletd api.");
            this._sendRequest('reset', 9, false, req_params, 10000, true).then(() => {
              //logDebugMsg("sent api reset to walletd...");
              return resolve(true);
            }).catch((err) => {
              return reject(new Error("reset err: "+err));
            });
        }).catch((err) => { /* just eat it... connection timeouts are common here */ });
    }
    stop() { 
        return new Promise((resolve, reject) => {
           this._sendRequest('stop', 2, false, {}, 10000, true).then((result) => {
               return resolve(result);
           }).catch((err) => {
               resolve("stopped"); // not fatal... the process may have just ended anyway
           });
        });
    }
    resume() {
        return new Promise((resolve, reject) => {
           this._sendRequest('resume', 2, false, {}, 10000, true).then((result) => {
               return resolve(result);
           }).catch((err) => {
               resolve("stopped"); // not fatal... the process may have just ended anyway
           });
        });
    }
    // note: getStatus (against walletd) only works if daemon confirmed as running first.
    getStatus() {

        //this.logDebugMsg("in api getStatus()...");

        return new Promise((resolve, reject) => {

            if (! this.daemonIsRunning) {

              //this.logDebugMsg("getinfo used as a test for daemon...");

              // use getInfo to test if the daemon is working first
              this._sendRequest('getinfo', 2, true, {}, 20000, false).then((result) => {

                //this.logDebugMsg("getinfo test results ... : "+JSON.stringify(result));
                // set this.daemonIsRunning based on return value

                if (result.last_known_block_index > 0)
                {
                  this.daemonIsRunning = true;
                  this.timeStamp_Status = Math.floor(Date.now());
                }

                // don't resolve .. return resolve(result); 
              }).catch((e) => {return reject(new Error("getinfo err: "+e));});

              //this.logDebugMsg("getinfo not ready yet..");

              return reject(new Error("daemon not ready, so walletd also not ready"));
            } else {
              let newTimeStamp = Math.floor(Date.now());
              if ((newTimeStamp-this.timeStamp_Status) < 3000)
                return reject(new Error("insufficient time elapsed"));
              this.timeStamp_Status = newTimeStamp;

              //this.logDebugMsg("NEW getStatus sendRequest...");

              let requestID = 'FED'+this.randomBytes(8).toString('hex'); 
              let req_params = {
                jsonrpc: '2.0',
                id: requestID,
                method: "getStatus" 
              };
              let contentLen = Buffer.byteLength(JSON.stringify(req_params));
              var authoriz = "Basic " + Buffer.from("fedadmin:"+this.walletd_password).toString('base64');
              let headerss = {
                'Connection': 'Keep-Alive',
                'Content-Type': 'application/json',
                'Content-Length': contentLen,
                'authorization': authoriz,
                'request-id': requestID
              };
              this.getHttpContent('getStatus', false, this.walletd_port, 'POST', req_params,
                10000, true, authoriz, headerss).then((html) => {
                let jsonVals = JSON.parse(html);
                //this.logDebugMsg("api getStatus: "+JSON.stringify(jsonVals));
                return resolve(jsonVals);
              }).catch((err) => {return reject(new Error("getstat err: "+err));});
            }
        });
    }
    getInfo() {
        return new Promise((resolve, reject) => {

            //this.logDebugMsg("GETINFO!!!!!");
            let newTimeStamp = Math.floor(Date.now());
            if ((newTimeStamp-this.timeStamp_Info) < 1000)
              return reject(new Error("insufficient time elapsed"));
            this.timeStamp_Info = newTimeStamp;

            this._sendRequest('getinfo', 6, true, {}, 10000, false).then((result) => {
              this.logDebugMsg("GETINFO RETURNED: "+JSON.stringify(result));
              return resolve(result);
            }).catch((err) => {
              return reject(new Error("getInfo err: "+err));
            });
        });
    }
    getViewKey() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getViewKey', 7, false, {}, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(new Error("viewkey err: "+err));
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
            this._sendRequest('getSpendKeys', 7, false, req_params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(new Error("spendkey err: "+err));
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
            this._sendRequest('getMnemonicSeed', 7, false, req_params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(new Error("mneumonic err: "+err));
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

            //this.logDebugMsg("getBackupKeys: address: "+params.address);

            this.getViewKey().then((vkres) => {
                //this.logDebugMsg("getViewKey result: "+JSON.stringify(vkres));
                backupKeys.viewSecretKey = vkres.result.viewSecretKey;
            }).then(() => {
                //this.logDebugMsg("now get spendkeys"); 
                this.getSpendKeys(req_params).then((vsres) => {
                  //this.logDebugMsg("spendkeys result: "+JSON.stringify(vsres));
                  backupKeys.spendSecretKey = vsres.result.spendSecretKey;
                  //this.logDebugMsg("backupKeys"+JSON.stringify(backupKeys));
                  //this.logDebugMsg(`viewSecretKey: ${backupKeys.viewSecretKey}`);
                  //this.logDebugMsg(`spendSecretKey: ${backupKeys.spendSecretKey}`);
                  return resolve(backupKeys);  
                }).catch((err) => { return reject(new Error("backup err: "+err)); }); 
            }).catch((err) => { return reject(new Error("back err: "+err)); });
        
            // this.getMnemonicSeed(req_params).then((mres) => {
            // backupKeys.mnemonicSeed = mres.mnemonicSeed;
        });
    }
    getTransactions(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.firstBlockIndex = params.firstBlockIndex || 1;
            params.blockCount = params.blockCount || 100;
            this._sendRequest('getTransactions', 7, false, params, 20000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return reject(new Error("get transactions no result"));
            }).catch((err) => {
                return reject(new Error("getTs err: "+err));
            });
        });
    }
    // send single transaction
    sendTransaction(useMixin, params) {
        //this.logDebugMsg("api sendTransaction, useMixin: "+useMixin);
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

            //logDebugMsg("sendTransaction: "+JSON.stringify(req_params));
            // give extra long timeout
            this._sendRequest('sendTransaction', 4, false, req_params, 45000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return reject(new Error("send transaction no result"));
            }).catch((err) => {
                //logDebugMsg("sendTransaction has FAILED: "+err);
                return reject(new Error("sendT err" + err));
            });
        });
    }
    estimateFusion(params) {
        return new Promise((resolve, reject) => {
            params = params || {};

            //logDebugMsg(`estimateFusion params: ${JSON.stringify(params)}`);

            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            this._sendRequest('estimateFusion', 4, false, params, 30000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return reject(new Error("estimate fusion no result"));
            }).catch((err) => {
                //logDebugMsg("estimate fusion has FAILED: "+err); 
                return reject(new Error("est fusion err"+err));
            });
        });
    }
    sendFusionTransaction(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            if (!params.anonimity) params.anonimity = 0;
            this._sendRequest('sendFusionTransaction', 4, false, params, 10000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return resolve("fusion ended");
            }).catch((err) => {
                //logDebugMsg("send fusion has FAILED: "+err);
                return reject(new Error("send fusion err: "+err));
            });
        });
    }
    createIntegratedAddress(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.address || !params.paymentId) {
                return reject(new Error('Address and Payment Id parameters are required'));
            }
            
            this._sendRequest('createIntegratedAddress', 6, false, params, 10000, true).then((rslt) => {
              if (rslt.result !== undefined)
                return resolve(rslt.result);
              else
                return reject(new Error("integrated addr no result"));
            }).catch((err) => {
                return reject(new Error("integrated addr err: "+err));
            });
        });
    }
    getHeight() {
      return new Promise((resolve, reject) => {

        let newTimeStamp = Math.floor(Date.now());
        if ((newTimeStamp-this.timeStamp_Height) < 1000)
          return reject(new Error("insufficient time elapsed"));
        this.timeStamp_Height= newTimeStamp;

        let hVal = {}; 
        let params = {};
        this.getHttpContent('getheight', true, this.daemon_port, 'GET', params,
           10000, false, '', {}) 
        .then((html) => {
          //this.logDebugMsg("html: "+html);
          hVal = JSON.parse(html);
          //let datum = html.match(/(?<=:\s*).*?(?=\s*,)/gs);
          //hVal = JSON.parse(datum);
          //this.logDebugMsg("getHeight called in api: "+JSON.stringify(hVal));
          return resolve(hVal);
        }).catch((err) => {return reject(new Error("getH err: "+err));});
      });
    }
}

module.exports = WalletShellApi;

