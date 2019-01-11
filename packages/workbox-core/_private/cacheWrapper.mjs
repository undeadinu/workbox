/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

import {assert} from './assert.mjs';
import {getFriendlyURL} from './getFriendlyURL.mjs';
import {logger} from './logger.mjs';
import {executeQuotaErrorCallbacks} from './quota.mjs';
import {WorkboxError} from './WorkboxError.mjs';
import {pluginEvents} from '../models/pluginEvents.mjs';
import {pluginUtils} from '../utils/pluginUtils.mjs';
import '../_version.mjs';

/**
 * Wrapper around cache.put().
 *
 * Will call `cacheDidUpdate` on plugins if the cache was updated.
 *
 * @param {Object} options
 * @param {string} options.cacheName
 * @param {Request} options.request
 * @param {Response} options.response
 * @param {Event} [options.event]
 * @param {Array<Object>} [options.plugins=[]]
 *
 * @private
 * @memberof module:workbox-core
 */
const putWrapper = async ({
  cacheName,
  request,
  response,
  event,
  plugins = [],
} = {}) => {
  if (!response) {
    if (process.env.NODE_ENV !== 'production') {
      logger.error(`Cannot cache non-existent response for ` +
        `'${getFriendlyURL(request.url)}'.`);
    }

    throw new WorkboxError('cache-put-with-no-response', {
      url: getFriendlyURL(request.url),
    });
  }

  let responseToCache =
      await _isResponseSafeToCache({request, response, event, plugins});

  if (!responseToCache) {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Response '${getFriendlyURL(request.url)}' will not be ` +
        `cached.`, responseToCache);
    }
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    if (responseToCache.method && responseToCache.method !== 'GET') {
      throw new WorkboxError('attempt-to-cache-non-get-request', {
        url: getFriendlyURL(request.url),
        method: responseToCache.method,
      });
    }
  }

  const cache = await caches.open(cacheName);

  const updatePlugins = pluginUtils.filter(
      plugins, pluginEvents.CACHE_DID_UPDATE);

  let oldResponse = updatePlugins.length > 0 ?
    await matchWrapper({cacheName, request}) : null;

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`Updating the '${cacheName}' cache with a new Response for ` +
      `${getFriendlyURL(request.url)}.`);
  }

  try {
    await cache.put(request, responseToCache);
  } catch (error) {
    // See https://developer.mozilla.org/en-US/docs/Web/API/DOMException#exception-QuotaExceededError
    if (error.name === 'QuotaExceededError') {
      await executeQuotaErrorCallbacks();
    }
    throw error;
  }

  for (let plugin of updatePlugins) {
    await plugin[pluginEvents.CACHE_DID_UPDATE].call(plugin, {
      cacheName,
      request,
      event,
      oldResponse,
      newResponse: responseToCache,
    });
  }
};

/**
 * This is a wrapper around cache.match().
 *
 * @param {Object} options
 * @param {string} options.cacheName Name of the cache to match against.
 * @param {Request} options.request The Request that will be used to look up
 *     cache entries.
 * @param {Event} [options.event] The event that propted the action.
 * @param {Object} [options.matchOptions] Options passed to cache.match().
 * @param {Array<Object>} [options.plugins=[]] Array of plugins.
 * @return {Response} A cached response if available.
 *
 * @private
 * @memberof module:workbox-core
 */
const matchWrapper = async ({
  cacheName,
  request,
  event,
  matchOptions,
  plugins = [],
}) => {
  const cache = await caches.open(cacheName);
  let cachedResponse = await cache.match(request, matchOptions);
  if (process.env.NODE_ENV !== 'production') {
    if (cachedResponse) {
      logger.debug(`Found a cached response in '${cacheName}'.`);
    } else {
      logger.debug(`No cached response found in '${cacheName}'.`);
    }
  }

  for (const plugin of plugins) {
    if (pluginEvents.CACHED_RESPONSE_WILL_BE_USED in plugin) {
      cachedResponse = await plugin[pluginEvents.CACHED_RESPONSE_WILL_BE_USED]
          .call(plugin, {
            cacheName,
            request,
            event,
            matchOptions,
            cachedResponse,
          });
      if (process.env.NODE_ENV !== 'production') {
        if (cachedResponse) {
          assert.isInstance(cachedResponse, Response, {
            moduleName: 'Plugin',
            funcName: pluginEvents.CACHED_RESPONSE_WILL_BE_USED,
            isReturnValueProblem: true,
          });
        }
      }
    }
  }

  return cachedResponse;
};

/**
 * This method will call cacheWillUpdate on the available plugins (or use
 * status === 200) to determine if the Response is safe and valid to cache.
 *
 * @param {Object} options
 * @param {Request} options.request
 * @param {Response} options.response
 * @param {Event} [options.event]
 * @param {Array<Object>} [options.plugins=[]]
 * @return {Promise<Response>}
 *
 * @private
 * @memberof module:workbox-core
 */
const _isResponseSafeToCache = async ({request, response, event, plugins}) => {
  let responseToCache = response;
  let pluginsUsed = false;
  for (let plugin of plugins) {
    if (pluginEvents.CACHE_WILL_UPDATE in plugin) {
      pluginsUsed = true;
      responseToCache = await plugin[pluginEvents.CACHE_WILL_UPDATE]
          .call(plugin, {
            request,
            response: responseToCache,
            event,
          });

      if (process.env.NODE_ENV !== 'production') {
        if (responseToCache) {
          assert.isInstance(responseToCache, Response, {
            moduleName: 'Plugin',
            funcName: pluginEvents.CACHE_WILL_UPDATE,
            isReturnValueProblem: true,
          });
        }
      }

      if (!responseToCache) {
        break;
      }
    }
  }

  if (!pluginsUsed) {
    if (process.env.NODE_ENV !== 'production') {
      if (!responseToCache.status === 200) {
        if (responseToCache.status === 0) {
          logger.warn(`The response for '${request.url}' is an opaque ` +
            `response. The caching strategy that you're using will not ` +
            `cache opaque responses by default.`);
        } else {
          logger.debug(`The response for '${request.url}' returned ` +
          `a status code of '${response.status}' and won't be cached as a ` +
          `result.`);
        }
      }
    }
    responseToCache = responseToCache.status === 200 ? responseToCache : null;
  }

  return responseToCache ? responseToCache : null;
};

export const cacheWrapper = {
  put: putWrapper,
  match: matchWrapper,
};
