/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

import {assert} from 'workbox-core/_private/assert.mjs';
import {cacheNames} from 'workbox-core/_private/cacheNames.mjs';
import {cacheWrapper} from 'workbox-core/_private/cacheWrapper.mjs';
import {fetchWrapper} from 'workbox-core/_private/fetchWrapper.mjs';
import {WorkboxError} from 'workbox-core/_private/WorkboxError.mjs';

import cleanRedirect from '../utils/cleanRedirect.mjs';
import createCacheKey from '../utils/createCacheKey.mjs';
import printCleanupDetails from '../utils/printCleanupDetails.mjs';
import printInstallDetails from '../utils/printInstallDetails.mjs';

import '../_version.mjs';

/**
 * Performs efficient precaching of assets.
 *
 * @memberof workbox.precaching
 */
class PrecacheController {
  /**
   * Create a new PrecacheController.
   *
   * @param {string} [cacheName] An optional name for the cache, to override
   * the default precache name.
   */
  constructor(cacheName) {
    this._cacheName = cacheNames.getPrecacheName(cacheName);
    this._urlsToCacheKeys = new Map();
  }

  /**
   * This method will add items to the precache list, removing duplicates
   * and ensuring the information is valid.
   *
   * @param {
   * Array<module:workbox-precaching.PrecacheController.PrecacheEntry|string>
   * } entries Array of entries to precache.
   */
  addToCacheList(entries) {
    if (process.env.NODE_ENV !== 'production') {
      assert.isArray(entries, {
        moduleName: 'workbox-precaching',
        className: 'PrecacheController',
        funcName: 'addToCacheList',
        paramName: 'entries',
      });
    }

    for (const entry of entries) {
      const {cacheKey, url} = createCacheKey(entry);
      this._urlsToCacheKeys.set(url, cacheKey);
    }
  }

  /**
   * Call this method from the service worker install event to precache new and
   * updated assets.
   *
   * @param {Object} options
   * @param {Event} [options.event] The install event (if needed).
   * @param {Array<Object>} [options.plugins] Plugins to be used for fetching
   * and caching during install.
   * @return {Promise<workbox.precaching.InstallResult>}
   */
  async install({event, plugins} = {}) {
    if (process.env.NODE_ENV !== 'production') {
      if (plugins) {
        assert.isArray(plugins, {
          moduleName: 'workbox-precaching',
          className: 'PrecacheController',
          funcName: 'install',
          paramName: 'plugins',
        });
      }
    }

    const urlsToPrecache = [];
    const urlsAlreadyPrecached = [];

    const cache = await caches.open(this._cacheName);
    const alreadyCachedRequests = await cache.keys();
    const alreadyCachedUrls = new Set(alreadyCachedRequests.map(
        (request) => request.url));

    for (const cacheKey of this._urlsToCacheKeys.values()) {
      if (alreadyCachedUrls.has(cacheKey)) {
        urlsAlreadyPrecached.push(cacheKey);
      } else {
        urlsToPrecache.push(cacheKey);
      }
    }

    const precacheRequests = urlsToPrecache.map((url) => {
      return this._addUrlToCache({event, plugins, url});
    });
    await Promise.all(precacheRequests);

    if (process.env.NODE_ENV !== 'production') {
      printInstallDetails(urlsToPrecache, urlsAlreadyPrecached);
    }

    return {
      updatedUrls: urlsToPrecache,
      notUpdatedUrls: urlsAlreadyPrecached,
    };
  }

  /**
   * Call this method from the service worker activate event to delete assets
   * that are no longer present in the current precache manifest.
   *
   * @return {Promise<workbox.precaching.CleanupResult>}
   */
  async activate() {
    const cache = await caches.open(this._cacheName);
    const currentlyCachedRequests = await cache.keys();
    const expectedCacheKeys = new Set(this._urlsToCacheKeys.values());

    const deletedUrls = [];
    for (const request of currentlyCachedRequests) {
      if (!expectedCacheKeys.has(request.url)) {
        await cache.delete(request);
        deletedUrls.push(request.url);
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      printCleanupDetails(deletedUrls);
    }

    return {deletedUrls};
  }

  /**
   * Requests the entry and saves it to the cache if the response is valid.
   * By default, any response with a status code of less than 400 (including
   * opaque responses) is considered valid.
   *
   * If you need to use custom criteria to determine what's valid and what
   * isn't, then pass in an item in `options.plugins` that implements the
   * `cacheWillUpdate()` lifecycle event.
   *
   * @private
   * @param {Object} options
   * @param {string} options.url The URL to fetch and cache.
   * @param {Event} [options.event] The install event (if passed).
   * @param {Array<Object>} [options.plugins] An array of plugins to apply to
   * fetch and caching.
   */
  async _addUrlToCache({url, event, plugins}) {
    const request = new Request(url, {credentials: 'same-origin'});
    let response = await fetchWrapper.fetch({
      event,
      plugins,
      request,
    });

    // Allow developers to override the default logic about what is and isn't
    // valid by passing in a plugin implementing cacheWillUpdate(), e.g.
    // a workbox.cacheableResponse.Plugin instance.
    let cacheWillUpdateCallback;
    for (const plugin of (plugins || [])) {
      if ('cacheWillUpdate' in plugin) {
        cacheWillUpdateCallback = plugin.cacheWillUpdate;
      }
    }

    const isValidResponse = cacheWillUpdateCallback ?
      // Use a callback if provided. It returns a truthy value if valid.
      cacheWillUpdateCallback({response}) :
      // Otherwise, default to considering any response status under 400 valid.
      // This includes, by default, considering opaque responses valid.
      response.status < 400;

    // Consider this a failure, leading to the `install` handler failing, if
    // we get back an invalid response.
    if (!isValidResponse) {
      throw new WorkboxError('bad-precaching-response', {
        url,
        status: response.status,
      });
    }

    if (response.redirected) {
      response = await cleanRedirect(response);
    }

    await cacheWrapper.put({
      event,
      plugins,
      request,
      response,
      cacheName: this._cacheName,
    });
  }

  /**
   * @return {Map<string, string>} The mapping of original URL to the
   * corresponding cache key.
   */
  getUrlsToCacheKeys() {
    return this._urlsToCacheKeys;
  }

  /**
   * Returns the cache key used for storing a given URL. If that URL is
   * unversioned, like `/index.html', then the cache key will be the original
   * URL with a search parameter appended to it.
   *
   * @param {string} url A URL whose cache key you want to look up.
   * @return {string} The versioned URL that corresponds to a cache key
   * for the original URL, or undefined if that URL isn't precached.
   */
  getCacheKeyForUrl(url) {
    const urlObject = new URL(url, location);
    return this._urlsToCacheKeys.get(urlObject.href);
  }
}

export default PrecacheController;
