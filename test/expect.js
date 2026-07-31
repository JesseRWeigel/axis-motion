'use strict';
// node:assert's `throws` does not hand back the error, and several tests here
// need to inspect the fields on it. `catches` runs fn, insists that it threw,
// insists on the type, and returns the error.

function catches(fn, Type) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (err === undefined) throw new Error('expected a throw, nothing was thrown');
  if (Type && !(err instanceof Type)) {
    throw new Error(
      `expected ${Type.name}, got ${err.name || 'Error'}: ${err.message}\n${err.stack || ''}`
    );
  }
  return err;
}

module.exports = { catches };
