// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

// Where to store icons and zip files
// Set to s3 to use Amazon S3, local to use the local filesystem
// (which must be configured with the correct permissions)
module.exports.FILE_STORAGE_BACKEND = 'local';

// The location where icons and zip files are stored
// If using the S3 storage backend, this could be the S3 website URL, or the URL
// of a CloudFront distribution mapping to the S3 bucket.
// If using the `local` storage backend, it must be the exact string "/download"
module.exports.CDN_HOST = '/download';

// The CDN to use for website assets (javascript, css, images files contained in public/ )
// If you are using CloudFront+S3, you can use `./scripts/sync-assets-to-s3.sh ${s3_bucket}`
// to upload the assets. If you are using CloudFront+ELB, you can simply point the
// CDN to the almond-cloud website; the website will act as origin server for the content
// and set appropriate cache headers.
// Use a fully qualified URL (including https://) and omit the trailing slash.
// Leave blank if you do not want to use a CDN, in which case assets will
// be loaded directly from the almond-cloud website.
module.exports.ASSET_CDN = '';

module.exports.THINGENGINE_MANAGER_ADDRESS = './control';
module.exports.THINGENGINE_DIRECT_ADDRESS = './direct';
module.exports.BING_KEY = '';

// set this to 'embedded' to enable the embedded Thingpedia,
// to 'external' to use the Thingpedia at THINGPEDIA_URL;
module.exports.WITH_THINGPEDIA = 'external';
// this is used to construct links to Thingpedia, eg from My Almond
// it MUST be set to '/thingpedia' to use the embedded Thingpedia
module.exports.THINGPEDIA_URL = 'https://thingpedia.stanford.edu/thingpedia';

// the origin (scheme, hostname, port) where the server is reachable
// this is used for redirects, and to enable special behavior for the main
// Almond website
module.exports.SERVER_ORIGIN = 'http://127.0.0.1:8080';

// enable redirection to SERVER_ORIGIN for requests with different hostname
// or scheme
module.exports.ENABLE_REDIRECT = true;

// enable Strict-Transport-Security, Content-Security-Policy and other
// security related headers
// requires TLS
module.exports.ENABLE_SECURITY_HEADERS = false;

// override which pug file to use for about pages
// use this to customize the index, terms-of-service, etc. pages
// the key should be the page name (part of path after /about)
// the value should be the name of a pug file in views, without the .pug
// extension
// if unspecified, defaults to "about_" + page_name, eg. for research
// it defaults to showing about_research.pug
//
// use ABOUT_OVERRIDE['index'] to override the whole website index
// note that "/about" with no page unconditionally redirects to "/"
module.exports.ABOUT_OVERRIDE = {};

// adds new pages to the /about hierarchy
// the format should be:
// {
//   url: path name, excluding /about part
//   title: page title
//   view: name of pug file
//   navbar: link label in navbar, or null to exclude from the navbar
// }
module.exports.EXTRA_ABOUT_PAGES = [];

// additional origins that should be allowed to make Cookie-authenticated
// API requests
module.exports.EXTRA_ORIGINS = [];

// the base URL used for OAuth redirects
//
// this is used by Login With Google
// the full OAuth redirect URI for Google is
// OAUTH_REDIRECT_ORIGIN + /user/oauth2/google/callback
//
// it is also used by the OAuth configuration mechanism for accounts/devices
// in Web Almond
// by default, it is the same as SERVER_ORIGIN, but you can change it
// if you put a different value in the developer console / redirect URI
// fields of the various services
module.exports.OAUTH_REDIRECT_ORIGIN = module.exports.SERVER_ORIGIN;

// the URL of a luinet-compatible Natural Language parsing server
module.exports.NL_SERVER_URL = 'https://almond-nl.stanford.edu';
// access token for administrative operations in luinet
module.exports.NL_SERVER_ADMIN_TOKEN = null;

// set to true to let users try out Almond without logging in
// they will operate as the user "anonymous"
module.exports.ENABLE_ANONYMOUS_USER = false;

// the following should be set in secret_config.js (which is not checked
// into git) or not set at all

// URL and access token for a server that supports autotraining when
// devices are updated in Thingpedia
module.exports.TRAINING_URL = null;
module.exports.TRAINING_ACCESS_TOKEN = null;

// Path to the luinet package (to be used by the auto training daemon)
module.exports.LUINET_PATH = './luinet';

// OAuth Client secret to support Login With Google
module.exports.GOOGLE_CLIENT_SECRET = null;

// Mailgun user/password to handle the "Request Developer Access" form
module.exports.MAILGUN_USER = null;
module.exports.MAILGUN_PASSWORD = null;

// The device to use as the primary "messaging" device (for communicating
// assistants
module.exports.MESSAGING_DEVICE = 'org.thingpedia.builtin.matrix';

// load more configuration that should not go in git (eg secret keys)
try {
    Object.assign(module.exports, require('./secret_config.js'));
} catch(e) {
    // ignore if there is no file
}
