"use strict";

function classifyPortOwnership({ busy, childPid, managedProcessRunning }) {
  if (!busy) {
    return "free";
  }
  if (childPid && managedProcessRunning) {
    return "managed";
  }
  return "unmanaged";
}

module.exports = { classifyPortOwnership };
