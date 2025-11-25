// ==UserScript==
// @name         Arca.live Image Flow Viewer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  通用卡片逻辑，视图切换
// @author       Henry W
// @match        https://arca.live/b/genshinskinmode*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const cardGap = 12;
    let isStreamBuilt = false;
    let isStreamViewActive = true;


    let streamContainer;
    let originalListContainer;
    let categoryWrapper;
    let toggleButton;


    function toggleView() {
        isStreamViewActive = !isStreamViewActive;

        if (isStreamViewActive) {
            streamContainer.style.display = 'grid';
            originalListContainer.style.display = 'none';
            if (categoryWrapper) categoryWrapper.style.display = 'none';
            toggleButton.textContent = '显示原版';
        } else {
            streamContainer.style.display = 'none';
            originalListContainer.style.display = 'block';
            if (categoryWrapper) categoryWrapper.style.display = 'block';
            toggleButton.textContent = '显示卡片流';
        }
    }


    function createToggleButton() {
        toggleButton = document.createElement('button');
        toggleButton.textContent = '显示原版';
        toggleButton.style.position = 'fixed';
        toggleButton.style.top = '80px';
        toggleButton.style.right = '20px';
        toggleButton.style.zIndex = '9999';
        toggleButton.style.padding = '10px 15px';
        toggleButton.style.backgroundColor = '#007bff';
        toggleButton.style.color = 'white';
        toggleButton.style.border = 'none';
        toggleButton.style.borderRadius = '5px';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        toggleButton.addEventListener('click', toggleView);
        document.body.appendChild(toggleButton);
    }

    function buildStream() {
        const firstImage = document.querySelector('a.vrow.column:not(.notice) .vrow-preview img');
        if (isStreamBuilt || !firstImage) {
            return;
        }

        isStreamBuilt = true;
        console.log("检测到图片已加载，开始构建卡片流...");

        originalListContainer = document.querySelector('.article-list .list-table.table');
        categoryWrapper = document.querySelector('.board-category-wrapper');

        const postElements = document.querySelectorAll('a.vrow.column:not(.notice)');
        streamContainer = document.createElement('div');
        streamContainer.id = 'universal-stream-container';

        const style = document.createElement('style');
        style.textContent = `
            #universal-stream-container {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
                gap: ${cardGap}px;
                padding: 10px;
                max-width: 1800px;
                margin: 0 auto;
            }
            #universal-stream-container > a {
                display: flex; flex-direction: column;
                overflow: hidden; border-radius: 8px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                transition: all 0.2s ease-in-out;
                aspect-ratio: 4 / 3; text-decoration: none;
            }
            #universal-stream-container > a:hover {
                transform: scale(1.05);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                z-index: 10; position: relative;
            }
            .image-card { background-color: #f0f0f0; }
            .image-card img { width: 100%; height: 100%; object-fit: cover; }
            .text-card {
                background-color: #ffffff; border: 1px solid #e9e9e9;
                padding: 12px; justify-content: space-between;
                box-sizing: border-box;
            }
            .text-card .card-title {
                font-size: 0.9em; font-weight: 600; color: #333;
                line-height: 1.4; display: -webkit-box;
                -webkit-line-clamp: 3; -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .text-card .card-meta {
                font-size: 0.75em; color: #888; margin-top: 8px;
            }
        `;
        document.head.appendChild(style);

        postElements.forEach(post => {
            const link = document.createElement('a');
            link.href = post.href;
            link.target = '_blank';

            const previewContainer = post.querySelector('.vrow-preview');

            if (previewContainer) {
                link.className = 'image-card';
                const thumbnail = previewContainer.querySelector('img');
                if (thumbnail) {
                    let thumbnailUrl = thumbnail.src;
                    if (thumbnailUrl.startsWith('//')) {
                        thumbnailUrl = 'https:' + thumbnailUrl;
                    }
                    const image = document.createElement('img');
                    image.src = thumbnailUrl;
                    image.alt = post.querySelector('.col-title .title')?.textContent.trim() || 'post-image';
                    image.onerror = () => { link.style.display = 'none'; };
                    link.appendChild(image);
                } else {
                    link.className = 'text-card';
                }
            } else {
                link.className = 'text-card';
                const title = post.querySelector('.col-title .title')?.textContent.trim() || 'No Title';
                const author = post.querySelector('.col-author')?.textContent.trim() || '';
                const time = post.querySelector('.col-time time')?.textContent.trim() || '';
                const titleEl = document.createElement('div');
                titleEl.className = 'card-title';
                titleEl.textContent = title;
                const metaEl = document.createElement('div');
                metaEl.className = 'card-meta';
                metaEl.textContent = `${author} · ${time}`;
                link.appendChild(titleEl);
                link.appendChild(metaEl);
            }
            streamContainer.appendChild(link);
        });

        originalListContainer.parentNode.insertBefore(streamContainer, originalListContainer);
        createToggleButton();

        originalListContainer.style.display = 'none';
        if (categoryWrapper) {
            categoryWrapper.style.display = 'none';
        }

        if (observer) {
            observer.disconnect();
            console.log("卡片流构建成功，MutationObserver 已停止。");
        }
    }


    const targetNode = document.querySelector('body');
    if (!targetNode) {
        console.log("无法找到监视目标 'body'，脚本无法启动。");
        return;
    }


    const observer = new MutationObserver(buildStream);
    observer.observe(targetNode, { childList: true, subtree: true });


    window.addEventListener('load', buildStream);

})();