#!/bin/bash
export PICLUSTER_AGENT_PATH="/root/picluster/agent"
cd $PICLUSTER_AGENT_PATH
$NODE_BIN agent.js
