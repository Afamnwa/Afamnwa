'use strict';
const { restoreIfNeeded, startLoop } = require('./backup');
(async () => {
  try { await restoreIfNeeded(); }
  catch (e) { console.error(e.message); process.exit(1); }
  require('./server');
  startLoop(require('./db').db);
})();
