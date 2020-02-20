const config = require('./ws_config.js');
const log = require('electron-log');
const http = require('http');

var request = require('request-promise-native');

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
    }

    setPassword(password) {
        this.walletd_password = password;
    }

    _sendRequest(method, todaemon, paramsIn, timeoutIn, needsAuth) {
        return new Promise((resolve, reject) => {
            if (method.length === 0) return reject(new Error('Invalid Method'));
            var params = paramsIn || {};
            var timeout = timeoutIn || 25000;
            var authoriz = "Basic " + Buffer.from("fedadmin:"+this.walletd_password).toString('base64');
            //log.warn("authoriz: "+authoriz);
            let data = {
                jsonrpc: '2.0',
                method: method,
                params: params
            };

            //log.warn("api using password: "+this.walletd_password);

            // needed to support certain systems that have very poor network latency
            var myAgent = new http.Agent({
                keepAlive: true,
                keepAliveMsecs: 25000
            });

            let headers = {
                'Connection':'Keep-Alive',
                'Agent':myAgent
            };

            if (needsAuth) {
              headers = {
                'Connection': 'Keep-Alive',
                'authorization': authoriz,
                'Agent': myAgent
              };
            }

            //log.warn("api calling method: "+method+" must authenticate: "+needsAuth);

            let s_uri = `http://${this.walletd_host}:${this.walletd_port}/json_rpc`;
            let s_type = 'POST';

            if (todaemon) {
                s_uri = `http://${this.daemon_host}:${this.daemon_port}/${method}`;
                s_type = 'GET';
                headers = {Connection: 'Keep-Alive', Agent: myAgent};
                data = {
                  jsonrpc: '2.0'
                };
            }

            request({
                uri: s_uri,
                method: s_type,
                headers: headers,
                body: data,
                json: true,
                pool: {maxSockets: 1280},
                timeout: timeout,
                time: true
            }).on('socket', function(socket){
                socket.setTimeout(24000);
            }).on('error', function(e) {
                // just eat the error, don't throw or stop
                // log.warn('error on socket: ', e);
            }).then((res) => {
                //note, this log makes a LOT of chatter when turned on...
                //log.warn(`request: ${JSON.stringify(res)}`);

                if (!res) return resolve(true);
                if (!res.error) {
                    if (res.result) return resolve(res.result);
                    return resolve(res);
                } else {
                    // this is not actually an error...
                    if (res.error.message == "Empty object list") {
                      return resolve(res);
                    }

                    //log.warn("err msg is: "+res.error.message);
                    return reject(res.error.message);
                }
            }).catch((err) => {
                //log.warn(`sendRequest has FAILED, ${err.message}`);
                return reject(err);
            });
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
    // used to determine state of sync for daemon fullnode
    getHeight() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getheight', true, {}, 20000, false).then((result) => {
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
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            let req_params = {
                address: params.address
            };
            this._sendRequest('getBalance', false, req_params, 9000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getStatus() {
        return new Promise((resolve, reject) => {
            let req_params = {};
            this._sendRequest('getStatus', false, req_params, 15000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getInfo() {
        //let req_params = {};
        return new Promise((resolve, reject) => {
            this._sendRequest('getinfo', true, {}, 10000, false).then((result) => {
                return resolve(result);
            }).catch((err) => {
                // Just eat any errors...
                //return reject(err);
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
    sendTransaction(params) {
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
                anonymity: 0, 
                unlockTime: 0,
                fee: params.fee
              };
            } else {
              req_params = {
                transfers: [{ address: params.address, amount: params.amount }],
                anonymity: 0,
                unlockTime: 0,
                fee: params.fee
              };
            }

            log.warn("sendTransaction: "+JSON.stringify(req_params));
            // give extra long timeout
            this._sendRequest('sendTransaction', false, req_params, 25000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                log.warn("sendTransaction has FAILED: "+err);
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
              log.warn("reset: secret key supplied... creating new wallet from secret key");
              req_params.viewSecretKey = params.viewSecretKey;
            }

            log.warn("sending reset to walletd api.");
            this._sendRequest('reset', false, req_params, 10000, true).then(() => {
              log.warn("sent api reset to walletd...");
              return resolve(true);
            }).catch((err) => {
              return reject(err);
            });
        }).catch((err) => { /* just eat it... connection timeouts are common here */ });
    }
    estimateFusion(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            this._sendRequest('estimateFusion', false, params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    sendFusionTransaction(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            if (!params.anonimity) params.anonimity = this.anonimity;
            this._sendRequest('sendFusionTransaction', false, params, 10000, true).then((result) => {
                return resolve(result);
            }).catch((err) => {
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
}

module.exports = WalletShellApi;
