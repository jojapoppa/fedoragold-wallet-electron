#!/bin/bash
curl -X GET -i -H "Accept: application/json" -d '{"jsonrpc": "2.0"}' http://localhost:31875/getheight
