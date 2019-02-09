#!/bin/sh
rm -r dist
rm -r build
mkdir dist
mkdir build
cp ./src/assets/icon.* ./build/

set DEBUG=electron-builder

rm -r bin
cp -r bin_linux bin
npm run dist-lin --no-bin-link --rollback=false

rm -r bin
cp -r bin_mac bin
#export CSC_IDENTITY_AUTO_DISCOVERY=false
npm config set FedoraGoldWallet:resourcedir ./Resources/bin/mac
npm run dist-mac --no-bin-link --rollback=false
cd dist/mac
#zip -r FedoraGoldWalletMac.zip FedoraGoldWallet.app
cd ../..

rm -r bin
cp -r bin_win bin
npm run dist-win --no-bin-link --rollback=false

# rm -r bin
