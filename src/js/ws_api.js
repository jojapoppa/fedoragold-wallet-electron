const request = require('request-promise-native');
const config = require('./ws_config.js');

class WalletShellApi {
    constructor(args) {
        args = args || {};
        if (!(this instanceof WalletShellApi)) return new WalletShellApi(args);
        this.service_host = args.service_host || '127.0.0.1';
        this.service_port = args.service_port || config.walletServiceRpcPort;
        this.service_password = args.service_password || "WHATEVER1234567891";
        this.minimum_fee = (args.minimum_fee !== undefined) ? args.minimum_fee : (config.minimumFee*config.decimalDivisor);
        this.anonimity = config.defaultMixin;
    }
    _sendRequest(method, params, timeout) {
        return new Promise((resolve, reject) => {
            if (method.length === 0) return reject(new Error('Invalid Method'));
            params = params || {};
            timeout = timeout || 3000;
            let data = {
                jsonrpc: '2.0',
                method: method,
                params: params,
                password: this.service_password
            };
            let s_host = this.service_host;
            let s_port = this.service_port;
            request({
                uri: `http://${s_host}:${s_port}/json_rpc`,
                method: 'POST',
                headers: {
                    Connection: 'keep-alive',
                },
                body: data,
                json: true,
                timeout: timeout
            }).then((res) => {
                if (!res) return resolve(true);
                if (!res.error) {
                    if (res.result) return resolve(res.result);
                    return resolve(res);
                } else {
                    return reject(res.error.message);
                }
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    // only get single addres only, no multi address support for this wallet, yet
    getAddress() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getAddresses').then((result) => {
                return resolve(result.addresses[0]);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getFeeInfo() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getFeeInfo').then((result) => {
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
            this._sendRequest('getBalance', req_params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getStatus() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getStatus').then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    save() {
        return new Promise((resolve, reject) => {
            this._sendRequest('save', {}, 6000).then(() => {
                return resolve();
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getViewKey() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getViewKey').then((result) => {
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
            this._sendRequest('getSpendKeys', req_params).then((result) => {
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
            this._sendRequest('getMnemonicSeed', req_params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getBackupKeys(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            if (params.address.length === 0) return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };
            var backupKeys = {};
            this.getViewKey().then((vkres) => {
                backupKeys.viewSecretKey = vkres.viewSecretKey;
                return vkres;
                //return Object.assign(vkres);
            }).then(() => {
                this.getSpendKeys(req_params).then((vsres) => {
                    backupKeys.spendSecretKey = vsres.spendSecretKey;
                    return vsres;
                }).catch((err) => {
                    return reject(err);
                });
            }).then(() => {
                this.getMnemonicSeed(req_params).then((mres) => {
                    backupKeys.mnemonicSeed = mres.mnemonicSeed;
                    return resolve(backupKeys);
                }).catch((err) => {
                    return reject(err);
                });
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getTransactions(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.firstBlockIndex = params.firstBlockIndex || 1;
            params.blockCount = params.blockCount || 100;
            var req_params = {
                firstBlockIndex: (params.firstBlockIndex >= 1) ? params.firstBlockIndex : 1,
                blockCount: (params.blockCount >= 1) ? params.blockCount : 100
            };
            this._sendRequest('getTransactions', req_params).then((result) => {
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
            //jojapoppa added anonymity(mixin) and unlockTime below	
            var req_params = {
                transfers: [{ address: params.address, amount: params.amount }],
                anonymity: 0, 
                unlockTime: 0,
                fee: params.fee
            };
            if (params.paymentId) req_params.paymentId = params.paymentId;
            // give extra long timeout
            this._sendRequest('sendTransaction', req_params, 10000).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    reset(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            //params.viewSecretKey = params.viewSecretKey || false;
            params.scanHeight = params.scanHeight || 0;
            let req_params = {};
            if (params.scanHeight && params.scanHeight > 1) {
                req_params = { scanHeight: params.scanHeight };
            }
            //if(params.viewSecretKey) req_params.viewSecretKey = params.viewSecretKey;
            this._sendRequest('reset', req_params).then(() => {
                return resolve(true);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    estimateFusion(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            this._sendRequest('estimateFusion', params).then((result) => {
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
            this._sendRequest('sendFusionTransaction', params).then((result) => {
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
            
            this._sendRequest('createIntegratedAddress', params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
}

module.exports = WalletShellApi;
