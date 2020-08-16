#!/bin/sh
rm -r dist
rm -r build
mkdir dist
mkdir build
cp ./src/assets/icon.* ./build/

# I was never able to get electron-builder to work from Alpine Linux
#   because support for wine32 is weak on Alpine, and that is currently
#   required to create windows compatible instrallers (which is required)
# The notes on where I left off with that here... will use Ubuntu for now...
# export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/lib:/usr/lib
# sudo apk --no-cache add ca-certificates wget
# sudo wget -q -O /etc/apk/keys/sgerrand.rsa.pub https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub
# wget https://github.com/sgerrand/alpine-pkg-glibc/releases/download/2.28-r0/glibc-2.28-r0.apk
# sudo apk add glibc-2.28-r0.apk
# npm install electron-builder
# ln -s /lib/libz.so.1 /usr/lib/
# sudo apk add gtk+3.0
# sudo apk add alsa-lib-dev
# sudo npm i pkg -g
# ln -s /usr/bin/wine64 /usr/bin/wine
#
# Precompiled SSL binaries can be found here: https://wiki.openssl.org/index.php/Binaries

set DEBUG=electron-builder

#mkdir dist/linux-unpacked
#cp node_modules/electron/dist/chrome-sandbox dist/linux-unpacked
#sudo chown root dist/linux-unpacked/chrome-sandbox
#sudo chmod 4755 dist/linux-unpacked/chrome-sandbox

#linux build
rm -r bin
cp -r bin_linux bin
npm run dist-lin --no-bin-link --rollback=false
cp dist/FedoraGoldWallet-v*AppImage /media/sf_sharedv

#cd ../..
#exit

#android build: see alternate project.json file
#rm -r bin
#cp -r bin_android bin
#npm run dist-lin --no-bin-link --rollback=false
#cp dist/FedoraGoldWallet-v*apk /media/sf_sharedv

#mac build
rm -r bin
cp -r bin_mac bin
#export CSC_IDENTITY_AUTO_DISCOVERY=false
npm config set FedoraGoldWallet:resourcedir ./Resources/bin/mac
npm run dist-mac --no-bin-link --rollback=false --max-old-space-size=4096
cd dist/mac
zip -r FedoraGoldWalletMac.zip FedoraGoldWallet.app
cd ../..
cp dist/mac/FedoraGoldWalletMac.zip /media/sf_sharedv/FedoraGoldWalletMac-v.zip

rm -r bin
cp -r bin_win bin
npm run dist-win --no-bin-link --rollback=false --debug-brk
cp dist/FedoraGoldWallet-v*exe /media/sf_sharedv

rm -r bin
cp dist/*.yml /media/sf_sharedv
