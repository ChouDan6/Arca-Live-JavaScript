// ==UserScript==
// @name         Arca Live Base64 Auto Decoder
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  自动识别页面中的Base64文本，支持多重加密递归解码。Auto-detect and recursive decode Base64 text to clickable URLs.
// @author       Henry W (@GuDongKing)
// @match        *://*.arca.live/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PROCESSED_CLASS = 'base64-processed-flag'; // 用于标记已处理元素的类名
    const CHUNK_SIZE = 50; // 每次处理的节点数量（分批处理防卡死）

    console.log('Arca Live Base64 Auto Decoder (Optimized) loaded.');

    // 递归解码函数
    function recursiveDecode(text, depth = 0) {
        if (depth > 5 || !text || text.length < 10) return null;
        // 简单的预检查：Base64通常不含空格（虽非绝对），且长度要是4的倍数（atob会自动容错一部分，但太乱的直接跳过）
        if (/\s/.test(text)) return null;

        try {
            const decoded = decodeURIComponent(escape(atob(text)));
            if (/^https?:\/\//i.test(decoded)) {
                return decoded;
            }
            return recursiveDecode(decoded, depth + 1);
        } catch (e) {
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

        // 每次取出一批节点进行处理
        // 使用 requestIdleCallback (如果有) 或 setTimeout 来避免阻塞 UI
        const processChunk = () => {
            const chunk = nodeQueue.splice(0, CHUNK_SIZE);

            chunk.forEach(node => {
                // 再次检查节点是否依然在文档中（防止处理期间被移除）
                if (document.body.contains(node)) {
                    processTextNode(node);
                }
            });

            if (nodeQueue.length > 0) {
                // 让出主线程，稍后继续处理
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

        // 1. 忽略特定的标签
        // 2. 关键修复：如果父级包含已处理的 class，绝对不要再处理，防止死循环
        if (!parent ||
            ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'A', 'CODE', 'PRE', 'NOSCRIPT'].includes(parent.tagName) ||
            parent.classList.contains(PROCESSED_CLASS) ||
            parent.closest('.' + PROCESSED_CLASS)
           ) {
            return;
        }

        const text = textNode.nodeValue;
        // 正则：匹配连续的 Base64 字符，长度至少20
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

                // 创建包裹原文的 span，并打上标记防止死循环
                const originalSpan = document.createElement('span');
                originalSpan.innerText = potentialBase64;
                originalSpan.className = PROCESSED_CLASS; // 关键标记
                originalSpan.style.opacity = "0.6";

                // 创建链接
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.innerText = `[🔗 ${url}]`;
                link.className = PROCESSED_CLASS; // 同样打上标记
                link.style.cssText = "color: #28a745; font-weight: bold; margin: 0 4px; text-decoration: underline;";

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

    // 将节点加入队列
    function queueNodes(nodes) {
        // 过滤掉非文本节点
        const textNodes = [];
        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // 如果是元素，使用 TreeWalker 找出内部所有文本节点
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

    // 1. 初始扫描
    queueNodes([document.body]);

    // 2. 监听动态加载
    const observer = new MutationObserver(mutations => {
        const nodesToAdd = [];
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                // 检查是否是我们自己添加的节点，如果是，直接忽略
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