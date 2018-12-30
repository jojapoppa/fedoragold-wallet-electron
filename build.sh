#!/bin/sh
rm -r dist
rm -r build
mkdir dist
mkdir build
cp ./src/assets/icon.* ./build/
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist-lin
npm run dist-mac
