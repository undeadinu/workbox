/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

import {checkSWFileCacheHeaders} from './_private/checkSWFileCacheHeaders.mjs';
import {logger} from '../_private/logger.mjs';
import '../_version.mjs';


// A WorkboxCore instance must be exported before we can use the logger.
// This is so it can get the current log level.
if (process.env.NODE_ENV !== 'production') {
  const padding = '   ';
  logger.groupCollapsed('Welcome to Workbox!');
  logger.unprefixed.log(`You are currently using a development build. ` +
    `By default this will switch to prod builds when not on localhost. ` +
    `You can force this with workbox.setConfig({debug: true|false}).`);
  logger.unprefixed.log(
      `📖 Read the guides and documentation\n` +
    `${padding}https://developers.google.com/web/tools/workbox/`
  );
  logger.unprefixed.log(
      `❓ Use the [workbox] tag on Stack Overflow to ask questions\n` +
    `${padding}https://stackoverflow.com/questions/ask?tags=workbox`
  );
  logger.unprefixed.log(
      `🐛 Found a bug? Report it on GitHub\n` +
    `${padding}https://github.com/GoogleChrome/workbox/issues/new`
  );
  logger.groupEnd();

  if (typeof checkSWFileCacheHeaders === 'function') {
    checkSWFileCacheHeaders();
  }
}
