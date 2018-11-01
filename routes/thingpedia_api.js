// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2015-2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const express = require('express');
const accepts = require('accepts');

const db = require('../util/db');
const schemaModel = require('../model/schema');
const entityModel = require('../model/entity');
const commandModel = require('../model/example');

const ThingpediaClient = require('../util/thingpedia-client');
const ImageCacheManager = require('../util/cache_manager');
const SchemaUtils = require('../util/manifest_to_schema');
const { tokenize } = require('../util/tokenize');

const Config = require('../config');
const Bing = require('node-bing-api')({ accKey: Config.BING_KEY });

const everything = express.Router();

const v1 = express.Router();
const v2 = express.Router();
const v3 = express.Router();

function errorWrap(req, res, next, promise) {
    Promise.resolve().then(() => promise).catch((e) => {
        if (typeof e.code === 'number')
            res.status(e.code);
        else if (e.code === 'ENOENT')
            res.status(404);
        else
            res.status(400);
        res.json({ error: e.message, code: e.code });
    }).catch(next);
}

// NOTES on versioning
//
// The whole API is exposed under /thingpedia/api/vX
//
// Any time an endpoint is changed incompatibly, make a
// copy of the endpoint and mount it under the newer vN
//
// To add a new endpoint, add it to the new vN only
// To remove an endpoint, add it to the vN with
// `next('router')` as the handler: this will cause the
// vN router to be skipped, failing back to the handler
// for / at the top (which returns 404)

/**
 * @api {get} /v1/schema/:schema_ids Get Type Information
 * @apiName GetSchema
 * @apiGroup Schemas
 * @apiVersion 0.1.0
 *
 * @apiDescription Retrieve the ThingTalk type information
 *   associated with the named schemas (device interfaces);
 *   multiple schemas can be requested at once, separated by a comma.
 *
 *   Returns an object with one property for each schema ID.
 *   If a given ID does not exist or is not visible to the calling user, this
 *   endpoint will silently return nothing.
 *
 * @apiParam {String[]} schema_ids The identifiers (kinds) of the schemas
 *   to retrieve
 * @apiParam {String} [developer_key] Developer key to use for this operation

 * @apiSuccess {Object} schema
 * @apiSuccess {Object} schema.id.triggers The triggers in this schema (obsolete, and always empty)
 * @apiSuccess {Object} schema.id.queries The queries in this schema
 * @apiSuccess {Object} schema.id.actions The actions in this schema
 * @apiSuccess {String[]} schema.id.actions.args The names of all parameters of this functions
 * @apiSuccess {String[]} schema.id.actions.types The ThingTalk type of all parameters of this function
 * @apiSuccess {Boolean[]} schema.id.actions.required For each parameter, the corresponding element in this array is `true` if the parameter is required, and `false` otherwise
 * @apiSuccess {Boolean[]} schema.id.actions.is_input For each parameter, the corresponding element in this array is `true` if the parameter is an input parameter, and `false` otherwise if the parameter is an output
 * @apiSuccess {Boolean} schema.id.actions.is_list Whether this function returns a list; this is always false for actions
 * @apiSuccess {Boolean[]} schema.id.actions.is_monitorable Whether this function can be monitored; this is always false for actions
 *
 * @apiSuccessExample {json} Example Response:
 *
 *  {
 *    "com.twitter": {
 *      "kind_type": "primary",
 *      "triggers": {},
 *      "queries": {
 *        "home_timeline": {
 *          "types": [
 *            "String",
 *            "Array(Entity(tt:hashtag))",
 *            "Array(Entity(tt:url))",
 *            "Entity(tt:username)",
 *            "Entity(tt:username)",
 *            "Entity(com.twitter:id)"
 *          ],
 *          "args": [
 *            "text",
 *            "hashtags",
 *            "urls",
 *            "author",
 *            "in_reply_to",
 *            "tweet_id"
 *          ],
 *          "required": [
 *            false,
 *            false,
 *            false,
 *            false,
 *            false,
 *            false
 *          ],
 *          "is_input": [
 *            false,
 *            false,
 *            false,
 *            false,
 *            false,
 *            false
 *          ],
 *          "is_list": true,
 *          "is_monitorable": true
 *        }
 *      },
 *      "actions": {
 *        "post": {
 *          "types": [
 *            "String"
 *          ],
 *          "args": [
 *            "status"
 *          ],
 *          "required": [
 *            true
 *          ],
 *          "is_input": [
 *            true
 *          ],
 *          "is_list": false,
 *          "is_monitorable": false
 *        }
 *      }
 *    }
 *  }
 *
**/
v1.get('/schema/:schemas', (req, res, next) => {
    var schemas = req.params.schemas.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getSchemas(schemas, false, 'application/json').then((obj) => {
        // don't cache if the user is a developer
        if (!req.query.developer_key)
            res.cacheFor(86400000);
        res.json(obj);
    }));
});

/**
 * @api {get} /v3/schema/:schema_ids Get Type Information And Metadata
 * @apiName GetSchema
 * @apiGroup Schemas
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the ThingTalk type information and natural language metadata
 *   associated with the named schemas (device interfaces);
 *   multiple schemas can be requested at once, separated by a comma.
 *
 *   This API performs content negotiation, based on the `Accept` header. If
 *   the `Accept` header is unset or set to `application/x-thingtalk`, then a ThingTalk
 *   dataset is returned. Otherwise, the accept header must be set to `application/json`,
 *   or a 405 Not Acceptable error occurs.
 *
 *   If set to return ThingTalk, this API returns a single ThingTalk meta file containing
 *   multiple classes. If set to return JSON, it returns an object with one property for each schema ID.
 *   If a given ID does not exist or is not visible to the calling user, this
 *   endpoint will silently return nothing. The documentation is here for the JSON response
 *   format. See ThingTalk's documentation for the syntax of meta files.
 *
 * @apiParam {String[]} schema_ids The identifiers (kinds) of the schemas
 *   to retrieve
 * @apiParam {Number{0-1}} meta Include natural language metadata in the output
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object} data An object with one property for each schema ID
 * @apiSuccess {Object} data.id Each schema
 * @apiSuccess {Object} data.id.triggers The triggers in this schema (obsolete, and always empty)
 * @apiSuccess {Object} data.id.queries The queries in this schema
 * @apiSuccess {Object} data.id.actions The actions in this schema
 * @apiSuccess {String[]} data.id.actions.args The names of all parameters of this functions
 * @apiSuccess {String[]} data.id.actions.types The ThingTalk type of all parameters of this function
 * @apiSuccess {Boolean[]} data.id.actions.required For each parameter, the corresponding element in this array is `true` if the parameter is required, and `false` otherwise
 * @apiSuccess {Boolean[]} data.id.actions.is_input For each parameter, the corresponding element in this array is `true` if the parameter is an input parameter, and `false` otherwise if the parameter is an output
 * @apiSuccess {Boolean} data.id.actions.is_list Whether this function returns a list; this is always false for actions
 * @apiSuccess {Boolean} data.id.actions.is_monitorable Whether this function can be monitored; this is always false for actions
 *
 * @apiSuccessExample {json} Example Response:
 *
 *  {
 *    "result": "ok",
 *    "data": {
 *      "com.twitter": {
 *        "kind_type": "primary",
 *        "triggers": {},
 *        "queries": {
 *          "home_timeline": {
 *            "types": [
 *              "String",
 *              "Array(Entity(tt:hashtag))",
 *              "Array(Entity(tt:url))",
 *              "Entity(tt:username)",
 *              "Entity(tt:username)",
 *              "Entity(com.twitter:id)"
 *            ],
 *            "args": [
 *              "text",
 *              "hashtags",
 *              "urls",
 *              "author",
 *              "in_reply_to",
 *              "tweet_id"
 *            ],
 *            "required": [
 *              false,
 *              false,
 *              false,
 *              false,
 *              false,
 *              false
 *            ],
 *            "is_input": [
 *              false,
 *              false,
 *              false,
 *              false,
 *              false,
 *              false
 *            ],
 *            "is_list": true,
 *            "is_monitorable": true
 *          }
 *        },
 *        "actions": {
 *          "post": {
 *            "types": [
 *              "String"
 *            ],
 *            "args": [
 *              "status"
 *            ],
 *            "required": [
 *              true
 *            ],
 *            "is_input": [
 *              true
 *            ],
 *            "is_list": false,
 *            "is_monitorable": false
 *          }
 *        }
 *      }
 *    }
 *  }
 *
**/
v3.get('/schema/:schemas', (req, res, next) => {
    const accept = accepts(req).types(['application/x-thingtalk', 'application/json', 'text/html']);
    if (!accept) {
        res.status(405).json({ error: 'must accept application/x-thingtalk or application/json' });
        return;
    }

    const schemas = req.params.schemas.split(',');
    const withMetadata = req.query.meta === '1';

    const client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getSchemas(schemas, withMetadata, accept).then((obj) => {
        res.set('Vary', 'Accept');

        // don't cache if the user is a developer
        if (!req.query.developer_key)
            res.cacheFor(86400000);
        if (typeof obj === 'string')
            res.set('Content-Type', accept === 'text/html' ? 'text/plain' : accept).send(obj);
        else
            res.json({ result: 'ok', data: obj });
    }));
});

/**
 * @api {get} /v1/schema-metadata/:schema_ids Get Type Information and Metadata
 * @apiName GetSchemaMetadata
 * @apiGroup Schemas
 * @apiVersion 0.1.0
 *
 * @apiDescription Retrieve the ThingTalk type information and natural language metadata
 *   associated with the named schemas (device interfaces);
 *   multiple schemas can be requested at once, separated by a comma.
 *
 *   Returns an object with one property for each schema ID.
 *   If a given ID does not exist or is not visible to the calling user, this
 *   endpoint will silently return nothing.
 *
 * @apiParam {String[]} schema_ids The identifiers (kinds) of the schemas
 *   to retrieve
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {Object} schema
 * @apiSuccess {Object} schema.id.triggers The triggers in this schema (obsolete, and always empty)
 * @apiSuccess {Object} schema.id.queries The queries in this schema
 * @apiSuccess {Object} schema.id.actions The actions in this schema
 * @apiSuccess {String[]} schema.id.actions.args The names of all parameters of this functions
 * @apiSuccess {String[]} schema.id.actions.types The ThingTalk type of all parameters of this function
 * @apiSuccess {Boolean[]} schema.id.actions.required For each parameter, the corresponding element in this array is `true` if the parameter is required, and `false` otherwise
 * @apiSuccess {Boolean[]} schema.id.actions.is_input For each parameter, the corresponding element in this array is `true` if the parameter is an input parameter, and `false` otherwise if the parameter is an output
 * @apiSuccess {Boolean} schema.id.actions.is_list Whether this function returns a list; this is always false for actions
 * @apiSuccess {Boolean} schema.id.actions.is_monitorable Whether this function can be monitored; this is always false for actions
 * @apiSuccess {String} schema.id.confirmation Confirmation string for this function
 * @apiSuccess {String} schema.id.confirmation_remote Remote confirmation string (obsolete)
 * @apiSuccess {String} schema.id.doc Documentation string for this function, to be shown eg. in a reference manual for the device
 * @apiSuccess {String} schema.id.canonical Short, concise description of this function, omitting stop words
 * @apiSuccess {String[]} schema.id.argcanonicals Translated argument names, to be used to construct sentences and display to the user; one element per argument
 * @apiSuccess {String[]} schema.id.questions Slot-filling questions
 *
 * @apiSuccessExample {json} Example Response:
 *
 *  {
 *    "com.twitter": {
 *      "kind_type": "primary",
 *      "triggers": {},
 *      "queries": {
 *        "home_timeline": {
 *          "types": [
 *            "String",
 *            "Array(Entity(tt:hashtag))",
 *            "Array(Entity(tt:url))",
 *            "Entity(tt:username)",
 *            "Entity(tt:username)",
 *            "Entity(com.twitter:id)"
 *          ],
 *          "args": [
 *            "text",
 *            "hashtags",
 *            "urls",
 *            "author",
 *            "in_reply_to",
 *            "tweet_id"
 *          ],
 *          "required": [
 *            false,
 *            false,
 *            false,
 *            false,
 *            false,
 *            false
 *          ],
 *          "is_input": [
 *            false,
 *            false,
 *            false,
 *            false,
 *            false,
 *            false
 *          ],
 *          "is_list": true,
 *          "is_monitorable": true,
 *          "confirmation": "tweets from anyone you follow",
 *          "confirmation_remote": "tweets from anyone $__person's follow",
 *          "doc": "shows your Twitter timeline (the home page of Twitter)",
 *          "canonical": "twitter home timeline",
 *          "argcanonicals": [
 *            "text",
 *            "hashtags",
 *            "urls",
 *            "author",
 *            "in reply to",
 *            "tweet id"
 *          ],
 *          "questions": [
 *            "",
 *            "",
 *            "",
 *            "",
 *            "",
 *            ""
 *          ]
 *        }
 *      },
 *      "actions": {
 *        "post": {
 *          "types": [
 *            "String"
 *          ],
 *          "args": [
 *            "status"
 *          ],
 *          "required": [
 *            true
 *          ],
 *          "is_input": [
 *            true
 *          ],
 *          "is_list": false,
 *          "is_monitorable": false,
 *          "confirmation": "tweet $status",
 *          "confirmation_remote": "post $status on $__person's Twitter",
 *          "doc": "post a tweet; use # to include a hashtag and @ to reply",
 *          "canonical": "post on twitter",
 *          "argcanonicals": [
 *            "status"
 *          ],
 *          "questions": [
 *            "What do you want to tweet?"
 *          ]
 *        }
 *      }
 *    }
 *  }
 *
**/
v1.get('/schema-metadata/:schemas', (req, res, next) => {
    var schemas = req.params.schemas.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getSchemas(schemas, true, 'application/json').then((obj) => {
        // don't cache if the user is a developer
        if (!req.query.developer_key)
            res.cacheFor(86400000);

        // return v1-compatible result (using the "schema" to indicate types
        // rather than "types")
        for (let kind in obj) {
            for (let what of ['triggers', 'queries', 'actions']) {
                for (let name in obj[kind][what]) {
                    obj[kind][what][name].schema = obj[kind][what][name].types;
                    delete obj[kind][what][name].types;
                }
            }
        }
        res.json(obj);
    }));
});

// in v3, /schema-metadata/ was merged with /schema, as in snapshot
v3.get('/schema-metadata/:schemas', (req, res, next) => next('router'));

/**
 * @api {get} /v1/code/devices/:kind Get Device Manifest
 * @apiName GetDeviceCode
 * @apiGroup Devices
 * @apiVersion 0.1.0
 *
 * @apiDescription Retrieve the manifest associated with the named device.
 *   See the [Guide to writing Thingpedia Entries](../thingpedia-device-intro.md)
 *   for a complete description of the manifest format.
 *
 * @apiParam {String} kind The identifier of the device to retrieve
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 */
v1.get('/code/devices/:kind', (req, res, next) => {
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getDeviceCode(req.params.kind, 'application/json').then((code) => {
        if (code.developer)
            res.cacheFor(3600000);
        else
            res.cacheFor(86400000);
        res.json(code);
    }));
});

/**
 * @api {get} /v3/devices/code/:kind Get Device Manifest
 * @apiName GetDeviceCode
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the manifest associated with the named device.
 *   See the [Guide to writing Thingpedia Entries](../thingpedia-device-intro.md)
 *   for a complete description of the manifest format.

 * This API performs content negotiation, based on the `Accept` header. If
 * the `Accept` header is unset or set to `application/x-thingtalk`, then a ThingTalk
 * dataset is returned. Otherwise, the accept header must be set to `application/json`,
 * or a 405 Not Acceptable error occurs.
 *
 * @apiParam {String} kind The identifier of the device to retrieve
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object} data The manifest, as a JSON object
 */
// in v3, /code/devices was moved to /devices/code, for
// consistency with the other /devices end points
v3.get('/code/devices/:kind', (req, res, next) => next('router'));
v3.get('/devices/code/:kind', (req, res, next) => {
    const accept = accepts(req).types(['application/x-thingtalk', 'application/json', 'text/html']);
    if (!accept) {
        res.status(405).json({ error: 'must accept application/x-thingtalk or application/json' });
        return;
    }

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getDeviceCode(req.params.kind, accept).then((code) => {
        res.set('Vary', 'Accept');
        if (typeof code === 'string') {
            const match = /#\[version=([0-9]+)\]/.exec(code);
            const version = match ? match[1] : -1;
            if (version >= 0)
                res.set('ETag', `W/"version=${version}"`);

            res.cacheFor(86400000);
            res.set('Content-Type', accept === 'text/html' ? 'text/plain' : accept);
            res.send(code);
        } else {
            const version = code.version;
            if (version >= 0)
                res.set('ETag', `W/"version=${version}"`);

            res.cacheFor(86400000);
            res.json({ result: 'ok', data: code });
        }
    }));
});

v1.get('/devices/setup/:kinds', (req, res, next) => {
    var kinds = req.params.kinds.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceSetup(kinds).then((result) => {
        for (let name in result) {
            if (result[name].type === 'multiple')
                result[name].choices = result[name].choices.map((c) => c.text);
        }
        return result;
    }).then((result) => {
        res.cacheFor(86400000);
        res.status(200).json(result);
    }).catch(next);
});

v2.get('/devices/setup/:kinds', (req, res, next) => {
    var kinds = req.params.kinds.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceSetup(kinds).then((result) => {
        res.cacheFor(86400000);
        res.status(200).json(result);
    }).catch(next);
});

/**
 * @api {get} /v3/devices/setup/:kinds Get Device Setup Information
 * @apiName GetDeviceSetup
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve configuration factories for the named devices
 *   or abstract classes. Returns an object with one property for each type given in the
 *   input.
 *
 *   If an abstract class is implemented by multiple devices, the return value is a factory
 *   of type `multiple`, with a single array `choices` containing multiple factories
 *   for each concrete device that implements the abstract class.
 *   If a device does not exist, is not visible, or is not configurable,
 *   a factory of type `multiple` with an empty list of `choices` is returned.
 *
 * @apiParam {String} kinds The identifiers of the devices or types to configure, separated by a comma
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object} data An object with one property for each requested kind
 * @apiSuccess {Object} data.factory A configuration factory
 * @apiSuccess {String} data.factory.kind The exact kind of the concrete device being configured
 * @apiSuccess {String} data.factory.text The user visible name of the device from the database
 * @apiSuccess {String="physical","online","data"} data.factory.category Whether the device is a phyisical device, online account, or public service
 * @apiSuccess {String="none","form","oauth2","discovery","interactive"} data.factory.type The factory type
 * @apiSuccess {String="upnp","bluetooth"} [data.factory.discoveryType] Discovery protocol; only present if `type` is equal to `discovery`
 * @apiSuccess {String="upnp","bluetooth"} [data.factory.discoveryType] Discovery protocol; only present if `type` is equal to `discovery`
 * @apiSuccess {Object[]} [data.factory.fields] Form fields to configure the device; only present if `type` is equal to `form`
 * @apiSuccess {String} [data.factory.fields.name] Parameter name associated with this form field
 * @apiSuccess {String} [data.factory.fields.label] User visible label for this field
 * @apiSuccess {String="text","password"} [data.factory.fields.type] The type of the form field; the meaning is the same as HTML5 `<input type>`
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": {
 *      "com.twitter": {
 *        "type": "oauth2",
 *        "category": "online",
 *        "kind": "com.twitter",
 *        "text": "Twitter Account"
 *      },
 *      "com.nest.security_camera": {
 *        "type": "oauth2",
 *        "category": "online",
 *        "kind": "com.nest",
 *        "text": "Nest Account"
 *      }
 *    }
 *  }
 */
v3.get('/devices/setup/:kinds', (req, res, next) => {
    var kinds = req.params.kinds.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceSetup(kinds).then((result) => {
        res.cacheFor(86400000);
        res.status(200).json({ result: 'ok', data: result });
    }).catch(next);
});

/**
 * @api {get} /v3/devices/icon/:kind Get Device Icon
 * @apiName GetDeviceIcon
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Download the icon for a given device.
 *   NOTE: this API returns the icon directly (it does not return JSON);
 *   it is suitable to use in e.g. `<img src>` but the caller must support
 *   HTTP redirects.
 *
 * @apiParam {String} kind The identifier of the device for which the icon is desired.
 */
v1.get('/devices/icon/:kind', (req, res) => {
    // cache for forever, this redirect will never expire
    res.cacheFor(6, 'months');

    if (req.query.style && /^[0-9]+$/.test(req.query.style)
        && req.query.style >= 1 && req.query.style <= 8)
       res.redirect(301, Config.CDN_HOST + '/icons/style-' + req.query.style + '/' + req.params.kind + '.png');
    else
       res.redirect(301, Config.CDN_HOST + '/icons/' + req.params.kind + '.png');
});

/**
 * @api {get} /v3/devices/package/:kind Get Device Package
 * @apiName GetDevicePackage
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Download the JS package for a given device.
 *
 * @apiParam {String} kind The identifier of the desired device.
 */
v3.get('/devices/package/:kind', (req, res, next) => {
    const kind = req.params.kind;
    const client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    errorWrap(req, res, next, client.getModuleLocation(kind, req.query.version).then((location) => {
        res.cacheFor(60000);
        res.redirect(302, location);
    }));
});

function isValidDeviceClass(req, res) {
    if (req.query.class &&
        ['online', 'physical', 'data', 'system',
         'media', 'social-network', 'home', 'communication',
         'health', 'service', 'data-management'].indexOf(req.query.class) < 0) {
        res.status(400).json({ error: "Invalid device class", code: 'EINVAL' });
        return false;
    } else {
        return true;
    }
}

v1.get('/devices', (req, res, next) => {
    if (!isValidDeviceClass(req, res))
        return;
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceFactories(req.query.class).then((obj) => {
        // convert to v1 format
        obj = obj.map((d) => {
            return {
                primary_kind: d.kind,
                name: d.text,
                factory: d
            };
        });

        res.cacheFor(86400000);
        res.json(obj);
    }).catch(next);
});

// the /devices endpoint was removed in v3
// to avoid confusion between /devices/setup and /devices/all

/**
 * @api {get} /v3/devices/setup Get Device Setup List
 * @apiName GetDeviceSetupList
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve configuration factories for all devices in Thingpedia.
 *
 * @apiParam {String="physical","online","data"} [class] If provided, only devices of this category are returned
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data The array of all factories
 * @apiSuccess {String} data.kind The exact kind of the concrete device being configured
 * @apiSuccess {String} data.text The user visible name of the device from the database
 * @apiSuccess {String="physical","online","data"} data.category Whether the device is a phyisical device, online account, or public service
 * @apiSuccess {String="none","form","oauth2","discovery","interactive"} data.type The factory type
 * @apiSuccess {String="upnp","bluetooth"} [data.discoveryType] Discovery protocol; only present if `type` is equal to `discovery`
 * @apiSuccess {String="upnp","bluetooth"} [data.discoveryType] Discovery protocol; only present if `type` is equal to `discovery`
 * @apiSuccess {Object[]} [data.fields] Form fields to configure the device; only present if `type` is equal to `form`
 * @apiSuccess {String} [data.fields.name] Parameter name associated with this form field
 * @apiSuccess {String} [data.fields.label] User visible label for this field
 * @apiSuccess {String="text","password"} [data.fields.type] The type of the form field; the meaning is the same as HTML5 `<input type>`
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "type": "oauth2",
 *        "category": "online",
 *        "kind": "com.twitter",
 *        "text": "Twitter Account"
 *      },
 *      {
 *        "type": "oauth2",
 *        "category": "online",
 *        "kind": "com.nest",
 *        "text": "Nest Account"
 *      },
 *      ...
 *    ]
 *  }
 */
v3.get('/devices', (req, res, next) => next('router'));
v3.get('/devices/setup', (req, res, next) => {
    if (!isValidDeviceClass(req, res))
        return;
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceFactories(req.query.class).then((obj) => {
        res.cacheFor(86400000);
        res.json({ result: 'ok', data: obj });
    }).catch(next);
});

function validatePageAndSize(req, defaultValue) {
    let page = req.query.page;
    if (page === undefined)
        page = 0;
    else
        page = parseInt(page);
    if (!isFinite(page) || page < 0)
        page = 0;
    let page_size = req.query.page_size;
    if (page_size === undefined)
        page_size = defaultValue;
    else
        page_size = parseInt(page_size);
    if (!isFinite(page_size) || page_size < 0)
        page_size = defaultValue;
    if (page_size > defaultValue)
        page_size = defaultValue;
    return [page, page_size];
}

v1.get('/devices/all', (req, res, next) => {
    const [page, page_size] = validatePageAndSize(req, 10);
    if (!isValidDeviceClass(req, res))
        return;

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceList(req.query.class || null, page, page_size).then((devices) => {
        res.cacheFor(86400000);
        res.json({ devices });
    }).catch(next);
});

/**
 * @api {get} /v3/devices/all Get Full Device List
 * @apiName GetDeviceList
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the list of all devices in Thingpedia.
 *   Results are paginated according to the `page` and `page_size` parameters.
 *
 * @apiParam {String="physical","online","data"} [class] If provided, only devices of this category are returned
 * @apiParam {Number{0-}} [page=0] Page number (0-based); negative page numbers are ignored
 * @apiParam {Number{1-10}} [page_size=10] Number of results to return
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data The array of all devices
 * @apiSuccess {String} data.primary_kind The primary identifier of the device
 * @apiSuccess {String} data.name The user visible name of the device
 * @apiSuccess {String} data.description A longer, user visible, description of the device
 * @apiSuccess {String="physical","online","data"} data.category Whether the device is a phyisical device, online account, or public service
 * @apiSuccess {String="home","data-management","communication","social-network","health","media","service"} data.subcategory The general domain of this device
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "primary_kind": "com.twitter",
 *        "name": "Twitter Account",
 *        "description": "Connect your Almond with Twitter",
 *        "category": "online",
 *        "subcategory": "social-network"
 *      },
 *      ...
 *    ]
 *  }
 */
v3.get('/devices/all', (req, res, next) => {
    const [page, page_size] = validatePageAndSize(req, 10);
    if (!isValidDeviceClass(req, res))
        return;

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceList(req.query.class || null, page, page_size).then((devices) => {
        res.cacheFor(86400000);
        res.json({ result: 'ok', data: devices });
    }).catch(next);
});

/**
 * @api {get} /v3/devices/search Search Devices by Keyword
 * @apiName GetDeviceSearch
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Search devices by keyword or name
 *
 * @apiParam {String} q Query string
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data The array of all devices
 * @apiSuccess {String} data.primary_kind The primary identifier of the device
 * @apiSuccess {String} data.name The user visible name of the device
 * @apiSuccess {String} data.description A longer, user visible, description of the device
 * @apiSuccess {String="physical","online","data"} data.category Whether the device is a phyisical device, online account, or public service
 * @apiSuccess {String="home","data-management","communication","social-network","health","media","service"} data.subcategory The general domain of this device
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "primary_kind": "com.twitter",
 *        "name": "Twitter Account",
 *        "description": "Connect your Almond with Twitter",
 *        "category": "online",
 *        "subcategory": "social-network"
 *      }
 *    ]
 *  }
 */
v1.get('/devices/search', (req, res, next) => {
    var q = req.query.q;
    if (!q) {
        res.status(400).json({ error: 'missing query' });
        return;
    }

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceSearch(q).then((devices) => {
        res.cacheFor(86400000);
        res.json({ devices });
    }).catch(next);
});

v3.get('/devices/search', (req, res, next) => {
    var q = req.query.q;
    if (!q) {
        res.status(400).json({ error: 'missing query' });
        return;
    }

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getDeviceSearch(q).then((devices) => {
        res.cacheFor(86400000);
        res.json({ result: 'ok', data: devices });
    }).catch(next);
});

function getCommandDetails(commands) {
    for (let command of commands) {
        // get device kinds from target_code
        let functions = command.target_code.split(' ').filter((code) => code.startsWith('@'));
        let devices = new Set(functions.map((f) => {
            let kind = f.split('.');
            kind.splice(-1, 1);
            kind = kind.join('.').substr(1);
            return kind;
        }));
        command.devices = Array.from(devices);
    }
}

/**
 * @api {get} /v3/commands/all Get All Commands from Commandpedia
 * @apiName GetAllCommands
 * @apiGroup Commandpedia
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the list of Commandpedia commands.
 *   Results are paginated according to the `page` and `page_size` parameters.
 *
 * @apiParam {Number{0-}} [page=0] Page number (0-based); negative page numbers are ignored
 * @apiParam {Number{1-9}} [page_size=9] Number of results to return
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data The array of all commands
 * @apiSuccess {Number} data.id Command ID
 * @apiSuccess {String} data.language 2 letter language code for this command
 * @apiSuccess {String="commandpedia"} data.type The internal command type
 * @apiSuccess {String} data.utterance The original, unprocessed command
 * @apiSuccess {String} data.preprocessed The command in tokenized form, as a list of tokens separated by a space
 * @apiSuccess {String} data.target_code The stored code associated with this command, in preprocess NN-Syntax ThingTalk
 * @apiSuccess {Number} data.click_count How popular this command is (number of users who have favorited it)
 * @apiSuccess {String} data.owner_name The username of the user who contributed this command
 * @apiSuccess {String[]} data.devices IDs of the devices referenced by this command
 * @apiSuccess {String[]} data.deviceNames User visible names of the devices referenced by this command
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "id": 1687826,
 *        "language": "en",
 *        "type": "commandpedia",
 *        "utterance": "if bitcoin price goes above $10000, notify me",
 *        "preprocessed": "if bitcoin price goes above CURRENCY_0 , notify me",
 *        "target_code": "edge ( monitor ( @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = \" bitcoin \" ^^tt:cryptocurrency_code ) ) on param:price:Currency >= CURRENCY_0 => notify",
 *        "click_count": 2,
 *        "owner_name": "sileixu",
 *        "devices": [
 *          "com.cryptonator"
 *        ],
 *      },
 *      ...
 *    ]
 *  }
 */
v1.get('/commands/all', (req, res, next) => {
    const language = (req.query.locale || 'en').split(/[-_@.]/)[0];
    const [page, page_size] = validatePageAndSize(req, 9);

    db.withTransaction((client) => {
        return commandModel.getCommands(client, language, page * page_size, page_size).then((commands) => {
            getCommandDetails(commands);
            res.cacheFor(3600 * 1000);
            res.json({ result: 'ok', data: commands });
        });
    }).catch(next);
});

/**
 * @api {get} /v3/commands/search Search Commands by Keyword
 * @apiName SearchCommands
 * @apiGroup Commandpedia
 * @apiVersion 0.3.0
 *
 * @apiDescription Search commands in Commandpedia by keyword.
 *
 * @apiParam {String} q Query string
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data The array of all commands
 * @apiSuccess {Number} data.id Command ID
 * @apiSuccess {String} data.language 2 letter language code for this command
 * @apiSuccess {String="commandpedia"} data.type The internal command type
 * @apiSuccess {String} data.utterance The original, unprocessed command
 * @apiSuccess {String} data.preprocessed The command in tokenized form, as a list of tokens separated by a space
 * @apiSuccess {String} data.target_code The stored code associated with this command, in preprocess NN-Syntax ThingTalk
 * @apiSuccess {Number} data.click_count How popular this command is (number of users who have favorited it)
 * @apiSuccess {String} data.owner_name The username of the user who contributed this command
 * @apiSuccess {String[]} data.devices IDs of the devices referenced by this command
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "id": 1687826,
 *        "language": "en",
 *        "type": "commandpedia",
 *        "utterance": "if bitcoin price goes above $10000, notify me",
 *        "preprocessed": "if bitcoin price goes above CURRENCY_0 , notify me",
 *        "target_code": "edge ( monitor ( @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = \" bitcoin \" ^^tt:cryptocurrency_code ) ) on param:price:Currency >= CURRENCY_0 => notify",
 *        "click_count": 2,
 *        "owner_name": "sileixu",
 *        "devices": [
 *          "com.cryptonator"
 *        ]
 *      },
 *      ...
 *    ]
 *  }
 */
v1.get('/commands/search', (req, res, next) => {
    const language = (req.query.locale || 'en').split(/[-_@.]/)[0];
    let q = req.query.q;
    if (!q) {
        res.status(400).json({ error: 'missing query' });
        return;
    }

    db.withTransaction((client) => {
        return commandModel.getCommandsByFuzzySearch(client, language, q).then((commands) => {
            getCommandDetails(commands);
            res.cacheFor(3600 * 1000);
            res.json({ result: 'ok', data: commands });
        });
    }).catch(next);
});


v1.get('/apps', (req, res) => {
    // deprecated endpoint
    res.json([]);
});
v2.get('/apps', (req, res, next) => next('router'));

v1.get('/code/apps/:app_id', (req, res) => {
    // deprecated endpoint, respond with 410 Gone
    res.status(410).send('This end point no longer exists');
});
v2.get('/code/apps/:app_id', (req, res, next) => next('router'));

v1.post('/discovery', (req, res, next) => {
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);

    errorWrap(req, res, next, client.getKindByDiscovery(req.body).then((result) => {
        if (result === null) {
            res.status(404).json({ error: 'Not Found' });
            return;
        }

        res.cacheFor(86400000);
        res.status(200).send(result.primary_kind);
    }).catch((e) => {
        if (e.message === 'Not Found')
            res.status(404).json({ error: 'Not Found' });
        else
            throw e;
    }));
});

/**
 * @api {post} /v3/devices/discovery Resolve Discovery Information
 * @apiName Discovery
 * @apiGroup Devices
 * @apiVersion 0.3.0
 *
 * @apiDescription Convert public discovery information gathered locally
 *   to the identifier of a device in Thingpedia.
 *
 *   See the thingpedia-discovery module for documentation on the format
 *   of the discovery data.
 *
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object} data Result from the Thingpedia lookup
 * @apiSuccess {String} data.kind The identifier of the best device to use for this discovery operation
 *
 */
// the /discovery endpoint was moved to /devices/discovery in v3
v3.post('/discovery', (req, res, next) => next('router'));
v3.post('/devices/discovery', (req, res, next) => {
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);

    errorWrap(req, res, next, client.getKindByDiscovery(req.body).then((result) => {
        if (result === null) {
            res.status(404).json({ error: 'Not Found' });
            return;
        }

        res.cacheFor(86400000);
        res.status(200).json({ result: 'ok', data: { kind: result.primary_kind } });
    }).catch((e) => {
        if (e.message === 'Not Found')
            res.status(404).json({ error: 'Not Found' });
        else
            throw e;
    }));
});

v1.get('/examples/by-kinds/:kinds', (req, res, next) => {
    var kinds = req.params.kinds.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);

    client.getExamplesByKinds(kinds, 'application/json;apiVersion=1').then((result) => {
        res.cacheFor(300000);
        res.status(200).json(result);
    }).catch(next);
});

/**
 * @api {get} /v3/examples/by-kinds/:kinds Get Example Commands By Device
 * @apiName GetExamplesByKinds
 * @apiGroup Cheatsheet
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the example commands from the cheatsheet for
 *   the given devices.
 *
 * This API performs content negotiation, based on the `Accept` header. If
 * the `Accept` header is unset or set to `application/x-thingtalk`, then a ThingTalk
 * dataset is returned. Otherwise, the accept header must be set to `application/json`,
 * or a 405 Not Acceptable error occurs.
 *
 * @apiParam {String[]} kinds Comma-separated list of device identifiers for which to return examples
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of example commands
 * @apiSuccess {Number} data.id Command ID
 * @apiSuccess {String} data.language 2 letter language code for this command
 * @apiSuccess {String="thingpedia"} data.type The internal command type
 * @apiSuccess {String} data.utterance The original, unprocessed command
 * @apiSuccess {String} data.preprocessed The command in tokenized form, as a list of tokens separated by a space
 * @apiSuccess {String} data.target_code The stored code associated with this command, in preprocess NN-Syntax ThingTalk
 * @apiSuccess {Number} data.click_count How popular this command is (number of users who have used it)
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "id": 1688881,
 *        "language": "en",
 *        "type": "thingpedia",
 *        "utterance": "when someone i follow replies to user ${p_in_reply_to} on twitter",
 *        "preprocessed": "when someone i follow replies to user ${p_in_reply_to} on twitter",
 *        "target_code": "let stream x := \\(p_in_reply_to :Entity(tt:username)) -> monitor ((@com.twitter.home_timeline()), in_reply_to == p_in_reply_to);",
 *        "click_count": 1
 *      }
 *    ]
 *  }
 *
 */
v3.get('/examples/by-kinds/:kinds', (req, res, next) => {
    var kinds = req.params.kinds.split(',');
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    const accept = accepts(req).types(['application/x-thingtalk', 'application/json', 'text/html']);
    if (!accept) {
        res.status(405).json({ error: 'must accept application/x-thingtalk or application/json' });
        return;
    }

    client.getExamplesByKinds(kinds, accept).then((result) => {
        res.set('Vary', 'Accept');
        res.cacheFor(300000);
        res.status(200);
        res.set('Content-Type', accept === 'text/html' ? 'text/plain' : accept);
        if (typeof result === 'string')
            res.send(result);
        else
            res.status(200).json({ result: 'ok', data: result });
    }).catch(next);
});

v1.get('/examples', (req, res, next) => {
    if (!req.query.key) {
        res.status(400).json({ error: "missing query" });
        return;
    }

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getExamplesByKey(req.query.key, 'application/json;apiVersion=1').then((result) => {
        res.cacheFor(300000);
        res.status(200).json(result);
    }).catch(next);
});

/**
 * @api {get} /v3/examples/search Get Example Commands By Keyword
 * @apiName SearchExamples
 * @apiGroup Cheatsheet
 * @apiVersion 0.3.0
 *
 * @apiDescription Search the example commands matching the given query
 *  string. Use this API endpoint to perform autocompletion and provide suggestions.
 *
 * This API performs content negotiation, based on the `Accept` header. If
 * the `Accept` header is unset or set to `application/x-thingtalk`, then a ThingTalk
 * dataset is returned. Otherwise, the accept header must be set to `application/json`,
 * or a 405 Not Acceptable error occurs.
 *
 * @apiParam {String} q Query string
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of example commands
 * @apiSuccess {Number} data.id Command ID
 * @apiSuccess {String} data.language 2 letter language code for this command
 * @apiSuccess {String="thingpedia"} data.type The internal command type
 * @apiSuccess {String} data.utterance The original, unprocessed command
 * @apiSuccess {String} data.preprocessed The command in tokenized form, as a list of tokens separated by a space
 * @apiSuccess {String} data.target_code The stored code associated with this command, in preprocess NN-Syntax ThingTalk
 * @apiSuccess {Number} data.click_count How popular this command is (number of users who have used it)
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "id": 1688881,
 *        "language": "en",
 *        "type": "thingpedia",
 *        "utterance": "when someone i follow replies to user ${p_in_reply_to} on twitter",
 *        "preprocessed": "when someone i follow replies to user ${p_in_reply_to} on twitter",
 *        "target_code": "let stream x := \\(p_in_reply_to :Entity(tt:username)) -> monitor ((@com.twitter.home_timeline()), in_reply_to == p_in_reply_to);",
 *        "click_count": 1
 *      }
 *    ]
 *  }
 *
 */
// the /examples?key=.. endpoint was moved to /examples/search?q=... in v3
// for consistency with /commands and /devices
v3.get('/examples', (req, res, next) => next('router'));
v3.get('/examples/search', (req, res, next) => {
    if (!req.query.q) {
        res.status(400).json({ error: "missing query" });
        return;
    }
    const accept = accepts(req).types(['application/x-thingtalk', 'application/json', 'text/html']);
    if (!accept) {
        res.status(405).json({ error: 'must accept application/x-thingtalk or application/json' });
        return;
    }

    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);
    client.getExamplesByKey(req.query.q, accept).then((result) => {
        res.cacheFor(300000);
        res.status(200);
        res.set('Content-Type', accept === 'text/html' ? 'text/plain' : accept);
        if (typeof result === 'string')
            res.send(result);
        else
            res.json({ result: 'ok', data: result });
    }).catch(next);
});

v1.get('/examples/click/:id', (req, res, next) => {
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);

    client.clickExample(req.params.id).then(() => {
        res.cacheFor(300000);
        res.status(200).json({ result: 'ok' });
    }).catch(next);
});

/**
 * @api {post} /v3/examples/click/:id Record Usage of Example Command
 * @apiName ClickExample
 * @apiGroup Cheatsheet
 * @apiVersion 0.3.0
 *
 * @apiDescription Record that the example with the given ID was used (clicked on).
 *
 * @apiParam {Number} id Example command ID
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok"
 *  }
 *
 */
// clicks were turned into a POST in v3
// (because the API is obviously not idempotent)
v3.get('/examples/click/:id', (req, res, next) => next('router'));
v3.post('/examples/click/:id', (req, res, next) => {
    var client = new ThingpediaClient(req.query.developer_key, req.query.locale);

    client.clickExample(req.params.id).then(() => {
        res.cacheFor(300000);
        res.status(200).json({ result: 'ok' });
    }).catch(next);
});

function getAllEntities(req, res, next) {
    const snapshotId = parseInt(req.query.snapshot);
    const etag = `"snapshot-${snapshotId}"`;
    if (snapshotId >= 0 && req.headers['if-none-match'] === etag) {
        res.set('ETag', etag);
        res.status(304).send('');
        return;
    }

    db.withClient((dbClient) => {
        if (snapshotId >= 0)
            return entityModel.getSnapshot(dbClient, snapshotId);
        else
            return entityModel.getAll(dbClient);
    }).then((rows) => {
        if (rows.length > 0 && snapshotId >= 0) {
            res.cacheFor(6, 'months');
            res.set('ETag', etag);
        } else {
            res.cacheFor(86400000);
        }
        res.status(200).json({ result: 'ok', data: rows.map((r) => ({
            type: r.id,
            name: r.name,
            is_well_known: r.is_well_known,
            has_ner_support: r.has_ner_support
        })) });
    }).catch(next);
}

v1.get('/entities', getAllEntities);

/**
 * @api {get} /v3/entities/all Get List of Entity Types
 * @apiName GetAllEntities
 * @apiGroup Entities
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the full list of entities supported entity types.
 *
 * @apiParam {Number} [snapshot=-1] Snapshot number. If provided, data corresponding to the given Thingpedia snapshot is returned; defaults to returning the current contents of Thingpedia.
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of entity types
 * @apiSuccess {Number} data.type Entity type identifier
 * @apiSuccess {String} data.name User-visible name of this entity type
 * @apiSuccess {Boolean} data.is_well_known Whether the entity type corresponds to a builtin type in ThingTalk
 * @apiSuccess {Boolean} data.has_ner_support Whether constants of this entity type
 *   can be expressed in natural language, and identified using Named Entity Recognition (NER)
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "type": "com.gmail:email_id",
 *        "name": "GMail Email ID",
 *        "is_well_known": 0,
 *        "has_ner_support": 0
 *      },
 *      {
 *        "type": "org.freedesktop:app_id",
 *        "name": "Freedesktop App Identifier",
 *        "is_well_known": 0,
 *        "has_ner_support": 1
 *      },
 *      {
 *        "type": "tt:stock_id",
 *        "name": "Company Stock ID",
 *        "is_well_known": 0,
 *        "has_ner_support": 1
 *      },
 *      {
 *        "type": "tt:email_address",
 *        "name": "Email Address",
 *        "is_well_known": 1,
 *        "has_ner_support": 0
 *      },
 *      ...
 *    ]
 *  }
 *
 */
// in v3, /entities was moved to /entities/all, for consistency
// with /devices and /commands
v3.get('/entities', (req, res, next) => next('router'));
v3.get('/entities/all', getAllEntities);

/**
 * @api {get} /v3/entities/lookup Lookup Entity By Name
 * @apiName EntityLookup
 * @apiGroup Entities
 * @apiVersion 0.3.0
 *
 * @apiDescription Lookup the type and value of an entity given its name.
 *   Use this endpoint to perform both Named Entity Recognition and Entity Linking.
 *
 * @apiParam {String} q Query String
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of candidate entity values; the list is not sorted and it is up to the client to identify the correct one
 * @apiSuccess {String} data.type Entity type identifier
 * @apiSuccess {String} data.value Opaque entity identifier
 * @apiSuccess {String} data.name User-visible name of this entity
 * @apiSuccess {String} data.canonical Preprocessed (tokenized and lower-cased) version of the user-visible name
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "type": "tt:stock_id",
 *        "value": "wmt",
 *        "canonical": "walmart inc.",
 *        "name": "Walmart Inc."
 *      }
 *    ]
 *  }
 *
 */
v1.get('/entities/lookup', (req, res, next) => {
    const language = (req.query.locale || 'en').split(/[-_@.]/)[0];
    const token = req.query.q;

    if (!token) {
        res.status(400).json({ error: 'missing query' });
        return;
    }
    
    db.withClient((dbClient) => {
        return entityModel.lookup(dbClient, language, token);
    }).then((rows) => {
        res.cacheFor(86400000);
        res.status(200).json({ result: 'ok', data: rows.map((r) => ({ type: r.entity_id, value: r.entity_value, canonical: r.entity_canonical, name: r.entity_name })) });
    }).catch(next);
});

/**
 * @api {get} /v3/entities/lookup/:type Lookup Entity By Type and Name
 * @apiName EntityLookupByType
 * @apiGroup Entities
 * @apiVersion 0.3.0
 *
 * @apiDescription Lookup the value of an entity given its type and name.
 *   Use this endpoint to perform Entity Linking after identifying an entity of
 *   a certain type.
 *
 * @apiParam {String} type Entity Type
 * @apiParam {String} q Query String
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of candidate entity values; the list is not sorted and it is up to the client to identify the correct one
 * @apiSuccess {String} data.type Entity type identifier
 * @apiSuccess {String} data.value Opaque entity identifier
 * @apiSuccess {String} data.name User-visible name of this entity
 * @apiSuccess {String} data.canonical Preprocessed (tokenized and lower-cased) version of the user-visible name
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "type": "tt:stock_id",
 *        "value": "wmt",
 *        "canonical": "walmart inc.",
 *        "name": "Walmart Inc."
 *      }
 *    ]
 *  }
 *
 */
v1.get('/entities/lookup/:type', (req, res, next) => {
    const language = (req.query.locale || 'en').split(/[-_@.]/)[0];
    const token = req.query.q;

    if (!token) {
        res.status(400).json({ error: 'missing query' });
        return;
    }
    
    errorWrap(req, res, next, db.withClient((dbClient) => {
        return Promise.all([entityModel.lookupWithType(dbClient, language, req.params.type, token),
                            entityModel.get(dbClient, req.params.type, language)]);
    }).then(([rows, meta]) => {
        res.cacheFor(86400000);
        res.status(200).json({
            result: 'ok',
            meta: { name: meta.name, has_ner_support: meta.has_ner_support, is_well_known: meta.is_well_known },
            data: rows.map((r) => ({ type: r.entity_id, value: r.entity_value, canonical: r.entity_canonical, name: r.entity_name }))
        });
    }));
});

v1.get('/entities/list/:type', (req, res, next) => {
    db.withClient((dbClient) => {
        return entityModel.getValues(dbClient, req.params.type);
    }).then((rows) => {
        res.cacheFor(86400000);
        res.status(200).json({ result: 'ok', data: rows.map((r) => ({ id: r.entity_value, name: r.entity_name })) });
    }).catch(next);
});

/**
 * @api {get} /v3/entities/list/:type List Entity Values
 * @apiName EntityList
 * @apiGroup Entities
 * @apiVersion 0.3.0
 *
 * @apiDescription Enumerate all allowed values for an entity of the given type.
 *
 * @apiParam {String} type Entity Type
 * @apiParam {String} q Query String
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of entity values
 * @apiSuccess {String} data.value Opaque entity identifier
 * @apiSuccess {String} data.name User-visible name of this entity
 * @apiSuccess {String} data.canonical Preprocessed (tokenized and lower-cased) version of the user-visible name
 *
 * @apiSuccessExample {json} Example Response:
 *  {
 *    "result": "ok",
 *    "data": [
 *      {
 *        "value": "aacc",
 *        "name": "Asset Acceptance Capital Corp.",
 *        "canonical": "asset acceptance capital corp."
 *      },
 *      {
 *        "value": "aait",
 *        "name": "iShares Trust iShares MSCI All Country Asia Information Techno",
 *        "canonical": "ishares trust ishares msci all country asia information techno"
 *      },
 *      {
 *        "value": "aame",
 *        "name": "Atlantic American Corporation",
 *        "canonical": "atlantic american corporation"
 *      },
 *      ...
 *    ]
 *  }
 *
 */
v3.get('/entities/list/:type', (req, res, next) => {
    db.withClient((dbClient) => {
        return entityModel.getValues(dbClient, req.params.type);
    }).then((rows) => {
        res.cacheFor(86400000);
        res.status(200).json({ result: 'ok', data: rows.map((r) => ({
            value: r.entity_value, name: r.entity_name, canonical: r.entity_canonical })) });
    }).catch(next);
});

function getEntityIcon(res, next, entityValue, entityType, entityDisplay) {
    const cacheManager = ImageCacheManager.get();
    if (entityType === 'tt:email_address' || entityType === 'tt:phone_number') {
        let cacheKey = 'contact:' + (entityType === 'tt:phone_number' ? 'phone' : 'email') + ':' + entityValue;
        let cached = cacheManager.get(cacheKey);
        if (cached)
            res.redirect(301, '/cache/' + cached);
        else
            res.redirect(301, Config.ASSET_CDN + '/images/user-no-avatar.png');
            //res.status(404).send('Not Found');
    } else {
        let cacheKey = entityType + ':' + entityValue;
        let cached = cacheManager.get(cacheKey);
        if (cached) {
            res.redirect(301, '/cache/' + cached);
            return;
        }

        let searchTerm = tokenize(entityDisplay || entityValue).join(' ');
        if (entityType === 'tt:iso_lang_code')
            searchTerm += ' flag';
        else
            searchTerm += ' logo png transparent';

        Q.ninvoke(Bing, 'images', searchTerm, { count: 1, offset: 0 }).then(([res, body]) => {
            return cacheManager.cache(cacheKey, body.value[0].contentUrl);
        }).then((filename) => {
            res.redirect(301, '/cache/' + filename);
        }).catch(next);
    }
}

v1.get('/entities/icon', (req, res, next) => {
    const entityValue = req.query.entity_value;
    const entityType = req.query.entity_type;
    const entityDisplay = req.query.entity_display || null;
    getEntityIcon(res, next, entityValue, entityType, entityDisplay);
});

/**
 * @api {get} /v3/entities/icon Get Entity Icon
 * @apiName GetEntityIcon
 * @apiGroup Entities
 * @apiVersion 0.3.0
 *
 * @apiDescription Download the icon for a given entity.
 *   NOTE: this API returns the icon directly (it does not return JSON);
 *   it is suitable to use in e.g. `<img src>` but the caller must support
 *   HTTP redirects.
 *
 * @apiParam {String} type The identifier of the entity type of this entity
 * @apiParam {String} value The opaque entity identifier
 * @apiParam {String} name The user visible name of this entity
 *
 * @apiParamExample Example Request:
 *   type=tt:stock_id&value=goog&name=Alphabet+Inc.
 */
v3.get('/entities/icon', (req, res, next) => {
    const entityValue = req.query.entity_value;
    const entityType = req.query.entity_type;
    const entityDisplay = req.query.entity_display || null;
    getEntityIcon(res, next, entityValue, entityType, entityDisplay);
});

/**
 * @api {get} /v3/snapshot/:snapshot Get Thingpedia Snapshot
 * @apiName GetSnapshot
 * @apiGroup Schemas
 * @apiVersion 0.3.0
 *
 * @apiDescription Retrieve the ThingTalk type information and natural language metadata
 *   from all the devices that were present in Thingpedia at the time of the
 *   given snapshot.
 *
 *   This API performs content negotiation, based on the `Accept` header. If
 *   the `Accept` header is unset or set to `application/x-thingtalk`, then a ThingTalk
 *   meta file is returned. Otherwise, the accept header must be set to `application/json`,
 *   or a 405 Not Acceptable error occurs.
 *
 * @apiParam {Number} snapshot The numeric Thingpedia snapshot identifier. Use -1 to refer to
 *  the current contents of Thingpedia.
 * @apiParam {Number{0-1}} meta Include natural language metadata in the output
 * @apiParam {String} [developer_key] Developer key to use for this operation
 * @apiParam {String} [locale=en-US] Locale in which metadata should be returned
 *
 * @apiSuccess {String} result Whether the API call was successful; always the value `ok`
 * @apiSuccess {Object[]} data List of schemas
 * @apiSuccess {Object} data.id Each schema
 * @apiSuccess {Object} data.id.triggers The triggers in this schema (obsolete, and always empty)
 * @apiSuccess {Object} data.id.queries The queries in this schema
 * @apiSuccess {Object} data.id.actions The actions in this schema
 * @apiSuccess {String[]} data.id.actions.args The names of all parameters of this functions
 * @apiSuccess {String[]} data.id.actions.types The ThingTalk type of all parameters of this function
 * @apiSuccess {Boolean[]} data.id.actions.required For each parameter, the corresponding element in this array is `true` if the parameter is required, and `false` otherwise
 * @apiSuccess {Boolean[]} data.id.actions.is_input For each parameter, the corresponding element in this array is `true` if the parameter is an input parameter, and `false` otherwise if the parameter is an output
 * @apiSuccess {Boolean} data.id.actions.is_list Whether this function returns a list; this is always false for actions
 * @apiSuccess {Boolean} data.id.actions.is_monitorable Whether this function can be monitored; this is always false for actions
 * @apiSuccess {String} data.id.confirmation Confirmation string for this function
 * @apiSuccess {String} data.id.confirmation_remote Remote confirmation string (obsolete)
 * @apiSuccess {String} data.id.doc Documentation string for this function, to be shown eg. in a reference manual for the device
 * @apiSuccess {String} data.id.canonical Short, concise description of this function, omitting stop words
 * @apiSuccess {String[]} data.id.argcanonicals Translated argument names, to be used to construct sentences and display to the user; one element per argument
 * @apiSuccess {String[]} data.id.questions Slot-filling questions
 *
**/

function getSnapshot(req, res, next, accept) {
    const getMeta = req.query.meta === '1';
    const language = (req.query.locale || 'en').split(/[-_@.]/)[0];
    const snapshotId = parseInt(req.params.id);
    const etag = `"snapshot-${snapshotId}-meta:${getMeta}-lang:${language}"`;
    if (snapshotId >= 0 && req.headers['if-none-match'] === etag) {
        res.set('ETag', etag);
        res.status(304).send('');
        return;
    }

    db.withClient((dbClient) => {
        if (snapshotId >= 0) {
            if (getMeta)
                return schemaModel.getSnapshotMeta(dbClient, snapshotId, language);
            else
                return schemaModel.getSnapshotTypes(dbClient, snapshotId);
        } else {
            if (getMeta)
                return schemaModel.getCurrentSnapshotMeta(dbClient, language);
            else
                return schemaModel.getCurrentSnapshotTypes(dbClient);
        }
    }).then((rows) => {
        if (rows.length > 0 && snapshotId >= 0) {
            res.cacheFor(6, 'months');
            res.set('ETag', etag);
        } else {
            res.cacheFor(3600000);
        }

        if (accept === 'application/json') {
            res.json({ result: 'ok', data: rows });
        } else {
            res.set('Content-Type', accept === 'text/html' ? 'text/plain' : accept);
            res.send(SchemaUtils.schemaListToClassDefs(rows, getMeta).prettyprint());
        }
    }).catch(next);
}

v1.get('/snapshot/:id', (req, res, next) => {
    getSnapshot(req, res, next, 'application/json');
});
v3.get('/snapshot/:id', (req, res, next) => {
    const accept = accepts(req).types(['application/x-thingtalk', 'application/json', 'text/html']);
    if (!accept) {
        res.status(405).json({ error: 'must accept application/x-thingtalk or application/json' });
        return;
    }
    res.set('Vary', 'Accept');

    getSnapshot(req, res, next, accept);
});

// all endpoints that have not been overridden in v2 use the v1 version
v2.use('/', v1);

// all endpoints that have not been overridden in v3 use the v2 version
v3.use('/', v2);

everything.use('/v1', v1);
everything.use('/v2', v2);
everything.use('/v3', v3);

// for compatibility with the existing code, v1 is also exposed unversioned
everything.use('/', v1);

// if nothing handled the route, return a 404
everything.use('/', (req, res) => {
    res.status(404).json({ error: 'Invalid endpoint' });
});

// if something failed, return a 500 in json form
everything.use('/', (err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message, code: err.code });
});

module.exports = everything;
