// ==UserScript==
// @name         Arca Live Base64 Auto Decoder (Fixed)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  自动识别页面中的Base64文本，支持多重加密递归解码。Auto-detect and recursive decode Base64 text to clickable URLs.
// @author       Henry W (@GuDongKing) - Optimized
// @match        *://*.arca.live/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PROCESSED_CLASS = 'base64-processed-flag'; // 用于标记已处理元素的类名
    const CHUNK_SIZE = 50; // 每次处理的节点数量

    console.log('Arca Live Base64 Auto Decoder (Optimized) loaded.');

    // 递归解码函数
    function recursiveDecode(text, depth = 0) {
        if (depth > 5 || !text || text.length < 10) return null;
        
        // 移除可能存在的两端空白字符
        let cleanText = text.trim();
        if (/\s/.test(cleanText)) return null;

        try {
            // 【修复 2】自动补全缺失的 '=' 填充，防止 atob() 抛出 DOMException
            while (cleanText.length % 4 !== 0) {
                cleanText += '=';
            }

            const decodedBytes = atob(cleanText);
            let decodedText;
            try {
                // 标准的 UTF-8 解码方式
                decodedText = decodeURIComponent(escape(decodedBytes));
            } catch (e) {
                // 降级容错
                decodedText = decodedBytes;
            }

            if (/^https?:\/\//i.test(decodedText)) {
                return decodedText;
            }
            return recursiveDecode(decodedText, depth + 1);
        } catch (e) {
            // 失败静默，直接返回 null
            return null;
        }
    }

    // 任务队列
    let nodeQueue = [];
    let isProcessing = false;

    // 启动队列处理
    function processQueue() {
        if (nodeQueue.length === 0) {
            isProcessing = false;
            return;
        }

        isProcessing = true;

        const processChunk = () => {
            const chunk = nodeQueue.splice(0, CHUNK_SIZE);

            chunk.forEach(node => {
                if (document.body.contains(node)) {
                    processTextNode(node);
                }
            });

            if (nodeQueue.length > 0) {
                if (window.requestIdleCallback) {
                    window.requestIdleCallback(processChunk);
                } else {
                    setTimeout(processChunk, 10);
                }
            } else {
                isProcessing = false;
            }
        };

        processChunk();
    }

    function processTextNode(textNode) {
        const parent = textNode.parentNode;

        // 【修复 1 & 3】
        // 移除了 'CODE' 和 'PRE'，允许解析代码块中的 Base64。
        // 新增了 isContentEditable 检查，防止在用户的回复输入框内发生替换干扰打字。
        if (!parent ||
            parent.isContentEditable || 
            ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'A', 'NOSCRIPT'].includes(parent.tagName) ||
            parent.classList.contains(PROCESSED_CLASS) ||
            parent.closest('.' + PROCESSED_CLASS)
           ) {
            return;
        }

        const text = textNode.nodeValue;
        // 正则：匹配连续的 Base64 字符
        const regex = /[A-Za-z0-9+/=]{20,}/g;

        let match;
        let lastIndex = 0;
        let fragment = null;
        let modified = false;

        while ((match = regex.exec(text)) !== null) {
            const potentialBase64 = match[0];
            const url = recursiveDecode(potentialBase64);

            if (url) {
                if (!fragment) fragment = document.createDocumentFragment();
                modified = true;

                // 添加匹配前的普通文本
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));

                // 创建包裹原文的 span
                const originalSpan = document.createElement('span');
                originalSpan.innerText = potentialBase64;
                originalSpan.className = PROCESSED_CLASS;
                originalSpan.style.opacity = "0.6";

                // 创建链接
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.innerText = `[🔗 ${url}]`;
                link.className = PROCESSED_CLASS;
                link.style.cssText = "color: #28a745; font-weight: bold; margin: 0 4px; text-decoration: underline; word-break: break-all;";

                fragment.appendChild(originalSpan);
                fragment.appendChild(link);

                lastIndex = regex.lastIndex;
            }
        }

        if (modified) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            parent.replaceChild(fragment, textNode);
        }
    }

    function queueNodes(nodes) {
        const textNodes = [];
        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
                let currentNode;
                while (currentNode = walker.nextNode()) {
                    textNodes.push(currentNode);
                }
            }
        });

        nodeQueue.push(...textNodes);

        if (!isProcessing) {
            processQueue();
        }
    }

    queueNodes([document.body]);

    const observer = new MutationObserver(mutations => {
        const nodesToAdd = [];
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains(PROCESSED_CLASS)) {
                    return;
                }
                nodesToAdd.push(node);
            });
        });
        if (nodesToAdd.length > 0) {
            queueNodes(nodesToAdd);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
