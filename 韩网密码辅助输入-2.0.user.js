// ==UserScript==
// @name         韩网密码辅助输入
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  支持新版kio.ac/kiosk.ac/nahida.live弹窗密码建议与自定义保存（内置在上，自定义在下）
// @author       Henry W（@GuDongKing）
// @match        https://kio.ac/*
// @match        https://kiosk.ac/*
// @match        https://nahida.live/mods*
// @match        https://nahida.live/akasha/mod/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    let suggestionBox = null;
    const customSuggestions = [];

    // === 动态生成日期密码 ===
    function getDynamicPassword() {
        const now = new Date();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        return `gayshin${month}${day}`;
    }

    const builtinSuggestions = [
        'gayshin',
        'ㅎ묘노ㅑㅜ',
        'GAYSHIN',
        'gayshin@',
        getDynamicPassword(), // 自动生成当天的 gayshinMMDD
        '0731',
        '第36行自行添加修改密码'
    ];

    // === 存储机制 ===
    function loadCustomSuggestions() {
        let globalData = GM_getValue('customSuggestionsV2', []);
        try {
            const localOld = JSON.parse(localStorage.getItem('customSuggestionsV2'));
            if (Array.isArray(localOld) && localOld.length > 0) {
                let hasNew = false;
                localOld.forEach(pwd => {
                    if (!globalData.includes(pwd)) {
                        globalData.push(pwd);
                        hasNew = true;
                    }
                });
                if (hasNew) GM_setValue('customSuggestionsV2', globalData);
            }
        } catch (e) {}
        customSuggestions.length = 0;
        globalData.forEach(item => customSuggestions.push(item));
    }

    function saveCustomSuggestions() {
        GM_setValue('customSuggestionsV2', customSuggestions);
    }

    function addCustomSuggestion(pwd) {
        if (!customSuggestions.includes(pwd)) {
            customSuggestions.push(pwd);
            saveCustomSuggestions();
        }
    }
    function removeCustomSuggestion(idx) {
        customSuggestions.splice(idx, 1);
        saveCustomSuggestions();
    }

    function setReactInputValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, value);
        } else {
            input.value = value;
        }
        ['input', 'change', 'keydown', 'keyup', 'blur', 'focus'].forEach(eventType => {
            input.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
        });
    }

    function removeSuggestionBox() {
        if (suggestionBox) {
            suggestionBox.remove();
            suggestionBox = null;
        }
    }

    function createSuggestions(input, buttonSelector) {
        removeSuggestionBox();

        // === 判断是否禁用添加功能 ===
        // KIO系列网站禁用“添加”，因为输入框会导致焦点抢夺
        const isKio = location.hostname.includes('kio') || location.hostname.includes('kiosk');
        const disableAddInput = isKio;

        suggestionBox = document.createElement('div');

        const scrollbarStyle = `
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: #2b2b2b; }
            ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: #777; }
        `;
        const styleEl = document.createElement('style');
        styleEl.textContent = `#tm-suggestion-box-container ${scrollbarStyle}`;

        suggestionBox.id = "tm-suggestion-box-container";
        suggestionBox.appendChild(styleEl);

        suggestionBox.style.cssText = `
            position: absolute;
            background: #2b2b2b;
            border: 2px solid #4a4a4a;
            padding: 10px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            z-index: 2147483647;
            font-size: 14px;
            min-width: 220px;
            margin-top: 5px;
            pointer-events: auto;
            max-height: 300px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        `;

        suggestionBox.addEventListener('focusin', (e) => e.stopPropagation());
        suggestionBox.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            input.dataset.tmInteracting = "true";
            setTimeout(() => { delete input.dataset.tmInteracting; }, 300);
        });
        suggestionBox.addEventListener('click', (e) => e.stopPropagation());

        const rect = input.getBoundingClientRect();
        suggestionBox.style.left = rect.left + window.scrollX + "px";
        suggestionBox.style.top = (rect.bottom + window.scrollY + 2) + "px";

        const onUserType = () => removeSuggestionBox();
        input.addEventListener('input', onUserType, { once: true });
        input.addEventListener('keydown', onUserType, { once: true });

        setTimeout(() => {
            const onClickOutside = (e) => {
                if (suggestionBox && !suggestionBox.contains(e.target) && e.target !== input) {
                    removeSuggestionBox();
                }
            };
            document.addEventListener('click', onClickOutside);
            if (suggestionBox) {
                const originalRemove = suggestionBox.remove.bind(suggestionBox);
                suggestionBox.remove = function() {
                    document.removeEventListener('click', onClickOutside);
                    input.removeEventListener('input', onUserType);
                    input.removeEventListener('keydown', onUserType);
                    originalRemove();
                };
            }
        }, 0);

        // === 只有非 KIO 网站才显示添加框 ===
        if (!disableAddInput) {
            const headerDiv = document.createElement('div');
            headerDiv.style.cssText = "position: sticky; top: -10px; background: #2b2b2b; padding-bottom: 8px; margin-top:-2px; z-index: 1;";

            const addContainer = document.createElement('div');
            addContainer.style.cssText = "display:flex; gap:4px;";
            const addInput = document.createElement('input');
            addInput.type = "text";
            addInput.placeholder = "添加自定义密码";
            addInput.style.cssText = `
                flex:1; padding: 4px 8px; border-radius:3px; border:1px solid #444;
                outline:none; font-size:14px; background:#222; color:#fff;
            `;
            addInput.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') addBtn.click();
            });
            addInput.addEventListener('input', (e) => e.stopPropagation());
            addInput.addEventListener('focus', (e) => e.stopPropagation());

            const addBtn = document.createElement('button');
            addBtn.textContent = "添加";
            addBtn.style.cssText = `
                padding: 4px 10px; background: #4a90e2; color: #fff; border: none;
                border-radius: 3px; cursor: pointer; font-size: 14px;
            `;
            addBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                const val = addInput.value.trim();
                if (!val) return;
                if (customSuggestions.includes(val)) { addInput.value = ""; return; }
                addCustomSuggestion(val);
                addInput.value = "";
                createSuggestions(input, buttonSelector);
            };
            addContainer.appendChild(addInput);
            addContainer.appendChild(addBtn);
            headerDiv.appendChild(addContainer);
            suggestionBox.appendChild(headerDiv);
        }

        // 列表区域
        const listContent = document.createElement('div');
        const suggestionClickHandler = (text) => {
            setReactInputValue(input, text);
            setTimeout(() => {
                const button = buttonSelector(input);
                if (button) {
                    if (button.disabled) button.removeAttribute('disabled');
                    button.click();
                }
            }, 100);
            removeSuggestionBox();
        };

        builtinSuggestions.forEach(text => {
            const item = document.createElement('div');
            item.textContent = text;
            item.style.cssText = `
                padding: 8px 12px; margin: 4px 0; color: #ffffff; background: #3a3a3a;
                border-radius: 3px; cursor: pointer; user-select: none; transition: all 0.2s ease; shrink: 0;
            `;
            item.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                suggestionClickHandler(text);
            });
            item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#4a4a4a'; });
            item.addEventListener('mouseleave', () => { item.style.backgroundColor = '#3a3a3a'; });
            listContent.appendChild(item);
        });

        if (customSuggestions.length > 0) {
            const sep = document.createElement('div');
            sep.style.cssText = "border-top:1px solid #444;margin:6px 0 2px 0;";
            listContent.appendChild(sep);
        }

        customSuggestions.forEach((text, idx) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center; margin: 4px 0;';
            const item = document.createElement('div');
            item.textContent = text;
            item.style.cssText = `
                flex:1; padding: 8px 12px; color: #fff; background: #3a3a3a;
                border-radius: 3px; cursor: pointer; user-select: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            `;
            item.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                suggestionClickHandler(text);
            });
            item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#4a4a4a'; });
            item.addEventListener('mouseleave', () => { item.style.backgroundColor = '#3a3a3a'; });

            row.appendChild(item);

            const delBtn = document.createElement('button');
            delBtn.textContent = "✕";
            delBtn.style.cssText = `
                margin-left:6px; background:transparent; color:#bbb; border:none;
                font-size:16px; cursor:pointer; border-radius:50%; shrink: 0; width: 24px;
            `;
            delBtn.onclick = (e) => {
                e.stopPropagation();
                input.dataset.tmInteracting = "true";
                removeCustomSuggestion(idx);
                createSuggestions(input, buttonSelector);
                setTimeout(() => { delete input.dataset.tmInteracting; }, 300);
            };
            row.appendChild(delBtn);

            listContent.appendChild(row);
        });

        suggestionBox.appendChild(listContent);
        document.body.appendChild(suggestionBox);

        const cleanResize = () => removeSuggestionBox();
        window.addEventListener('scroll', cleanResize, { once: true });
        window.addEventListener('resize', cleanResize, { once: true });
    }

    function globalPasswordInputWatcher() {
        const handledInputs = new WeakSet();
        function tryAttach(input, buttonSelector) {
            if (!handledInputs.has(input)) {
                handledInputs.add(input);
                const showHandler = (e) => {
                    if (input.dataset.tmInteracting === "true") return;
                    createSuggestions(input, buttonSelector);
                };
                input.addEventListener('focus', showHandler);
                input.addEventListener('click', showHandler);
                if (document.activeElement === input) createSuggestions(input, buttonSelector);
            }
        }

        const kioSelector = 'input[placeholder="Enter the password..."]';
        const nahidaModsSelector = 'input[placeholder="Password"]';
        const nahidaAkashaSelector = 'div[data-slot="card"] form input[data-slot="input"]';

        const kioButtonSelector = (input) => {
            let dialog = input.closest('div[role="dialog"][data-dialog-content]');
            return dialog?.querySelector('button[data-submit]') || document.querySelector('button[data-submit]');
        };

        const nahidaButtonSelector = (input) => {
            const form = input.closest('form');
            if (form) {
                const submitBtn = form.querySelector('button[type="submit"], button[data-slot="button"]');
                if (submitBtn) return submitBtn;
            }
            let container = input.closest('div.flex') || input.parentElement;
            if (container) {
                const siblingBtn = container.querySelector('button');
                if (siblingBtn) return siblingBtn;
            }
            return null;
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const processNode = (n) => {
                        if (location.hostname.includes('kio')) {
                            n.querySelectorAll?.(kioSelector).forEach(input => tryAttach(input, kioButtonSelector));
                            if (n.matches?.(kioSelector)) tryAttach(n, kioButtonSelector);
                        }
                        else if (location.href.includes('/mods')) {
                            n.querySelectorAll?.(nahidaModsSelector).forEach(input => tryAttach(input, nahidaButtonSelector));
                            if (n.matches?.(nahidaModsSelector)) tryAttach(n, nahidaButtonSelector);
                        }
                        else if (location.href.includes('/akasha/mod')) {
                            n.querySelectorAll?.(nahidaAkashaSelector).forEach(input => tryAttach(input, nahidaButtonSelector));
                            if (n.matches?.(nahidaAkashaSelector)) tryAttach(n, nahidaButtonSelector);
                        }
                    };
                    processNode(node);
                    if (node.querySelectorAll && location.href.includes('/akasha/mod')) {
                         node.querySelectorAll(nahidaAkashaSelector).forEach(input => tryAttach(input, nahidaButtonSelector));
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const checkNow = () => {
            if (location.href.includes('/akasha/mod')) {
                document.querySelectorAll(nahidaAkashaSelector).forEach(input => tryAttach(input, nahidaButtonSelector));
            } else if (location.href.includes('/mods')) {
                document.querySelectorAll(nahidaModsSelector).forEach(input => tryAttach(input, nahidaButtonSelector));
            } else {
                document.querySelectorAll(kioSelector).forEach(input => tryAttach(input, kioButtonSelector));
            }
        };
        checkNow();
        setTimeout(checkNow, 1000);
    }

    window.addEventListener('load', () => {
        loadCustomSuggestions();
        globalPasswordInputWatcher();
    });
    function cleanup() { removeSuggestionBox(); }
    window.addEventListener('unload', cleanup);
})();