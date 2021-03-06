// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond Cloud
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const { tokenize, rejoin } = require('../../util/tokenize');

function testTokenize() {
    assert.deepStrictEqual(tokenize('a b c'), ['a', 'b', 'c']);
    assert.deepStrictEqual(tokenize('a, b c'), ['a', ',', 'b', 'c']);
    assert.deepStrictEqual(tokenize('a,b c'), ['a', ',', 'b', 'c']);
    assert.deepStrictEqual(tokenize('a!b c'), ['a', '!', 'b', 'c']);
    assert.deepStrictEqual(tokenize('a!b-c'), ['a', '!', 'b-c']);
    assert.deepStrictEqual(tokenize('a!'), ['a', '!']);
    assert.deepStrictEqual(tokenize('a-b-c'), ['a-b-c']);
    assert.deepStrictEqual(tokenize('a_b_c'), ['a_b_c']);
    assert.deepStrictEqual(tokenize('A B C'), ['a', 'b', 'c']);
}

function testRejoin() {
    assert.strictEqual(rejoin(['a', 'b', 'c']), 'a b c');
    assert.strictEqual(rejoin(['a', '', 'c']), 'a  c');
    assert.strictEqual(rejoin(['', 'b', 'c']), ' b c');
}

function main() {
    testTokenize();
    testRejoin();
}
module.exports = main;
if (!module.parent)
    main();
