// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond Cloud
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('thingengine-core/lib/polyfill');
require('./polyfill');
process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');

const WD = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const firefox = require('selenium-webdriver/firefox');

const Config = require('../config');

const BASE_URL = process.env.THINGENGINE_URL || 'http://127.0.0.1:8080';

async function withSelenium(test) {
    const builder = new WD.Builder()
        .forBrowser('firefox');

    // on Travis CI we run headless; setting up Xvfb is
    // just annoying and not very useful
    if (process.env.TRAVIS) {
        builder
        .setFirefoxOptions(
            new firefox.Options().headless()
        )
        .setChromeOptions(
            new chrome.Options().headless()
        );
    }

    const driver = builder.build();
    try {
        await test(driver);
    } finally {
        driver.quit();
    }
}

async function fillFormField(driver, id, ...value) {
    const entry = await driver.findElement(WD.By.id(id));
    await entry.sendKeys(...value);
}

async function login(driver, username, password) {
    await driver.get(BASE_URL + '/');

    const loginLink = await driver.wait(
        WD.until.elementLocated(WD.By.linkText('Log In')),
        30000);
    await loginLink.click();

    const submit = await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);

    await fillFormField(driver, 'username', username);
    await fillFormField(driver, 'password', password);

    await submit.click();
}

async function testBasic(driver) {
    await driver.get(BASE_URL + '/');

    const title = await driver.wait(
        WD.until.elementLocated(WD.By.id('almond-title')),
        30000);

    assert.strictEqual(await title.getText(), 'Almond');
}

async function skipDataCollectionConfirmation(driver) {
    await driver.get(BASE_URL + '/me');
    await driver.wait(
        WD.until.elementLocated(WD.By.id('input')),
        30000);

    let messages = await driver.findElements(WD.By.css('.message'));
    assert.strictEqual(await messages[0].getText(), `Hello! I'm Almond, your virtual assistant.`); //'

    // ignore the blurb about data collection, skip to the yes/no question
    // at the end
    await driver.wait(
        WD.until.elementLocated(WD.By.css('.message.message-yesno.btn')),
        30000);
    const yesNo = await driver.findElements(WD.By.css('.message.message-yesno.btn'));
    assert.strictEqual(yesNo.length, 2);
    assert.strictEqual(await yesNo[0].getText(), 'Yes');
    assert.strictEqual(await yesNo[1].getText(), 'No');
    // click no
    await yesNo[1].click();
}

async function testMyConversation(driver) {
    await login(driver, 'bob', '12345678');

    await skipDataCollectionConfirmation(driver);

    // refresh the page
    await driver.get(BASE_URL + '/me');

    const inputEntry = await driver.wait(
        WD.until.elementLocated(WD.By.id('input')),
        30000);

    let messages = await driver.findElements(WD.By.css('.message'));
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(await messages[0].getText(), `Welcome back!`);

    await inputEntry.sendKeys('hello', WD.Key.ENTER);

    const ourInput = await driver.wait(
        WD.until.elementLocated(WD.By.css('.message.from-user:nth-child(2)')),
        10000);
    assert.strictEqual(await ourInput.getText(), 'hello');

    const response = await driver.wait(
        WD.until.elementLocated(WD.By.css('.from-almond:nth-child(3) .message')),
        10000);
    assert.strictEqual(await response.getText(), 'Hi!');
}

async function assertHasClass(element, className) {
    const classes = (await element.getAttribute('class')).split(' ');
    assert(classes.indexOf(className) >= 0,
        `expected ${element} to have class ${className}, found only [${classes}]`);
}
async function assertDoesNotHaveClass(element, className) {
    const classes = (await element.getAttribute('class')).split(' ');
    assert(classes.indexOf(className) < 0,
        `expected ${element} not to have class ${className}`);
}
async function assertElementValue(driver, cssSelector, expectedText) {
    const element = await driver.findElement(WD.By.css(cssSelector));
    assert.strictEqual(await element.getAttribute('value'), expectedText);
}

async function testRegister(driver) {
    await driver.get(BASE_URL + '/');

    if (Config.EXTRA_ABOUT_PAGES.find((x) => x.url === 'get-almond')) {
        // in Stanford mode, we click on Get Almond, and from there to Create An Account
        const getAlmond = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Get Almond')),
            30000);

        await getAlmond.click();

        const createAccount = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Create An Account')),
            30000);

        await createAccount.click();
    } else {
        // in product mode, we click on Log In, and from there to Sign Up Now!

        const logIn = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Log In')),
            30000);

        await logIn.click();

        const signUpNow = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Sign up now!')),
            30000);

        await signUpNow.click();
    }

    // now we're in the registration page
    const submit = await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);

    await fillFormField(driver, 'username', 'alice');
    await fillFormField(driver, 'email', 'alice@localhost');
    await fillFormField(driver, 'password', '1234');

    // the help text should be red by now
    const min8CharText = await driver.wait(
        WD.until.elementLocated(WD.By.css('.has-error > #password + .help-block')),
        30000);
    // and we cannot submit
    await assertHasClass(submit, 'disabled');

    // fill some more text
    await fillFormField(driver, 'password', '5678');
    // wait 1s...
    await driver.sleep(1000);

    // and now the help text should not be red
    await assertDoesNotHaveClass(min8CharText, 'with-errors');
    // we still cannot submit tho
    await assertHasClass(submit, 'disabled');

    // fill the confirmation now
    await fillFormField(driver, 'confirm-password', '12345677');

    // uh oh! we made a typo!
    const confirmPasswordText = await driver.wait(
        WD.until.elementLocated(WD.By.css('.has-error > #confirm-password + .help-block')),
        30000);

    assert.strictEqual(await confirmPasswordText.getText(),
        `The password and the confirmation must match`);

    // change and go back
    await fillFormField(driver, 'confirm-password', WD.Key.BACK_SPACE, '8');

    // no more error
    await driver.wait(WD.until.elementIsNotVisible(confirmPasswordText), 30000);
    // and we can submit
    await assertDoesNotHaveClass(submit, 'disabled');

    // so let's do it!
    await submit.click();

    // we're logged in, so we get a nice link to the Settings page
    const settingsLink = await driver.wait(
        WD.until.elementLocated(WD.By.linkText('Settings')),
        30000);

    // let's click it...
    await settingsLink.click();

    // wait until enough of the form is loaded...
    await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);

    // check it is us...
    await assertElementValue(driver, '#username', 'alice');
    await assertElementValue(driver, '#email', 'alice@localhost');
}

async function main() {
    await withSelenium(testBasic);
    await withSelenium(testMyConversation);
    await withSelenium(testRegister);
}
module.exports = main;
if (!module.parent)
    main();