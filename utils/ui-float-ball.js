import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName as immersiveSoundExtensionName } from './config.js';

const FLOAT_BALL_MIN_VISIBLE_SIZE = 20;
const FLOAT_BALL_DRAG_THRESHOLD = 5;

const floatBallStateManager = {
    _loadingCount: 0,
    _isPlaying: false,
    _updateUI() {
        const ball = $('#st-is-float-ball');
        if (!ball.length) return;

        // Loading state takes precedence
        if (this._loadingCount > 0) {
            ball.removeClass('st-is-playing').addClass('st-is-loading');
        } else {
            ball.removeClass('st-is-loading');
            if (this._isPlaying) {
                ball.addClass('st-is-playing');
            } else {
                ball.removeClass('st-is-playing');
            }
        }
    },
    startLoading() {
        this._loadingCount++;
        this._updateUI();
    },
    stopLoading() {
        this._loadingCount = Math.max(0, this._loadingCount - 1);
        this._updateUI();
    },
    setPlaying(isPlaying) {
        this._isPlaying = isPlaying;
        this._updateUI();
    },
    isPlaying() {
        return this._isPlaying;
    },
    isLoading() {
        return this._loadingCount > 0;
    }
};

function ensureFloatBallPositionSettings() {
    const settings = extension_settings[immersiveSoundExtensionName];
    if (!settings.float_ball_position || typeof settings.float_ball_position !== 'object') {
        settings.float_ball_position = {};
    }
    return settings.float_ball_position;
}

function getEventClientPosition(event) {
    if (event.type === 'touchstart' || event.type === 'touchmove' || event.type === 'touchend') {
        const touch = event.touches?.[0] ?? event.changedTouches?.[0];
        if (!touch) return null;
        return {
            clientX: touch.clientX,
            clientY: touch.clientY,
        };
    }

    return {
        clientX: event.clientX,
        clientY: event.clientY,
    };
}

function clampFloatBallPosition(left, top, ballWidth, ballHeight) {
    const visibleWidth = Math.min(FLOAT_BALL_MIN_VISIBLE_SIZE, ballWidth || FLOAT_BALL_MIN_VISIBLE_SIZE);
    const visibleHeight = Math.min(FLOAT_BALL_MIN_VISIBLE_SIZE, ballHeight || FLOAT_BALL_MIN_VISIBLE_SIZE);

    const minLeft = -(ballWidth - visibleWidth);
    const maxLeft = window.innerWidth - visibleWidth;
    const minTop = -(ballHeight - visibleHeight);
    const maxTop = window.innerHeight - visibleHeight;

    return {
        left: Math.min(Math.max(left, minLeft), maxLeft),
        top: Math.min(Math.max(top, minTop), maxTop),
    };
}

function applyFloatBallPosition(floatBall, left, top) {
    const ballWidth = floatBall.offsetWidth || floatBall.getBoundingClientRect().width;
    const ballHeight = floatBall.offsetHeight || floatBall.getBoundingClientRect().height;
    const nextPosition = clampFloatBallPosition(left, top, ballWidth, ballHeight);

    floatBall.style.left = `${nextPosition.left}px`;
    floatBall.style.top = `${nextPosition.top}px`;

    return nextPosition;
}

function getDefaultFloatBallPosition(size) {
    return {
        left: 20,
        top: Math.max(0, window.innerHeight / 2 - size / 2),
    };
}

function restoreFloatBallPosition(floatBall, size) {
    const positionSettings = ensureFloatBallPositionSettings();
    const savedLeft = Number.parseFloat(positionSettings.left);
    const savedTop = Number.parseFloat(positionSettings.top);
    const hasSavedPosition = Number.isFinite(savedLeft) && Number.isFinite(savedTop);
    const initialPosition = hasSavedPosition
        ? { left: savedLeft, top: savedTop }
        : getDefaultFloatBallPosition(size);

    applyFloatBallPosition(floatBall, initialPosition.left, initialPosition.top);
    floatBall.dataset.positionInitialized = 'true';
}

function persistFloatBallPosition(floatBall) {
    const positionSettings = ensureFloatBallPositionSettings();
    const rect = floatBall.getBoundingClientRect();
    const nextPosition = clampFloatBallPosition(rect.left, rect.top, rect.width, rect.height);

    positionSettings.left = `${Math.round(nextPosition.left)}px`;
    positionSettings.top = `${Math.round(nextPosition.top)}px`;
    saveSettingsDebounced();
}

function setFloatBallSelectionDisabled(disabled) {
    if (!document.body) return;

    if (disabled) {
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
    } else {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
    }
}

export function applyFloatBallSettings() {
    const settings = extension_settings[immersiveSoundExtensionName];
    const ball = $('#st-is-float-ball');
    if (!ball.length) return;

    if (settings.enable_float_ball) {
        ball.show();
        ball.css('background-color', settings.float_ball_bg_color || '#ADD8E6');
        ball.find('.st-is-icon').css('color', settings.float_ball_icon_color || '#FFFFFF');
        // Also set the loader's border-top-color
        ball.find('.st-is-loader').css('border-top-color', settings.float_ball_icon_color || '#FFFFFF');
        ball.css('opacity', settings.float_ball_opacity ?? 1);

        const size = settings.float_ball_size ?? 50;
        ball.css('width', `${size}px`);
        ball.css('height', `${size}px`);
        ball.find('.st-is-icon').css('font-size', `${Math.round(size * 0.48)}px`);
        
        const loaderSize = Math.round(size * 0.56);
        const loaderBorder = Math.max(2, Math.round(size * 0.08));
        ball.find('.st-is-loader').css({
            'width': `${loaderSize}px`,
            'height': `${loaderSize}px`,
            'border-width': `${loaderBorder}px`
        });

        const floatBall = ball.get(0);
        if (!floatBall.dataset.positionInitialized) {
            restoreFloatBallPosition(floatBall, size);
        } else {
            const currentLeft = Number.parseFloat(floatBall.style.left);
            const currentTop = Number.parseFloat(floatBall.style.top);

            if (Number.isFinite(currentLeft) && Number.isFinite(currentTop)) {
                applyFloatBallPosition(floatBall, currentLeft, currentTop);
            } else {
                restoreFloatBallPosition(floatBall, size);
            }
        }
    } else {
        ball.hide();
    }
}

export function initFloatBall() {
    // Create float ball element if it doesn't exist
    let floatBall = document.getElementById('st-is-float-ball');
    if (!floatBall) {
        floatBall = document.createElement('div');
        floatBall.id = 'st-is-float-ball';

        const defaultIcon = document.createElement('i');
        defaultIcon.className = 'fa-solid fa-headphones st-is-icon st-is-default-icon';

        const playingIcon = document.createElement('i');
        playingIcon.className = 'fa-solid fa-compact-disc st-is-icon st-is-playing-icon';
        
        const loader = document.createElement('div');
        loader.className = 'st-is-loader';

        floatBall.appendChild(defaultIcon);
        floatBall.appendChild(playingIcon);
        floatBall.appendChild(loader);
        document.body.appendChild(floatBall);
    }

    let isDragging = false;
    let hasMoved = false;
    let offsetX;
    let offsetY;
    let startX = 0;
    let startY = 0;
    let rafId = null;
    let pendingPosition = null;

    const updateFloatBallPosition = () => {
        if (pendingPosition) {
            floatBall.style.left = `${pendingPosition.left}px`;
            floatBall.style.top = `${pendingPosition.top}px`;
            pendingPosition = null;
        }
        rafId = null;
    };

    const dragStart = (e) => {
        const point = getEventClientPosition(e);
        if (!point) return;

        e.preventDefault();

        isDragging = true;
        hasMoved = false;
        floatBall.style.cursor = 'grabbing';
        setFloatBallSelectionDisabled(true);
        
        const rect = floatBall.getBoundingClientRect();
        startX = point.clientX;
        startY = point.clientY;
        offsetX = point.clientX - rect.left;
        offsetY = point.clientY - rect.top;

        document.addEventListener('mousemove', dragMove);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
    };

    const dragMove = (e) => {
        if (!isDragging) return;
        
        if (e.type === 'touchmove') {
            e.preventDefault();
        }

        const point = getEventClientPosition(e);
        if (!point) return;

        if (!hasMoved) {
            const moveDistance = Math.hypot(point.clientX - startX, point.clientY - startY);
            if (moveDistance < FLOAT_BALL_DRAG_THRESHOLD) {
                return;
            }
            hasMoved = true;
        }

        let newLeft = point.clientX - offsetX;
        let newTop = point.clientY - offsetY;

        const ballWidth = floatBall.offsetWidth;
        const ballHeight = floatBall.offsetHeight;
        const clampedPosition = clampFloatBallPosition(newLeft, newTop, ballWidth, ballHeight);

        pendingPosition = clampedPosition;

        if (!rafId) {
            rafId = requestAnimationFrame(updateFloatBallPosition);
        }
    };

    const dragEnd = (e) => {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        if (pendingPosition) {
            floatBall.style.left = `${pendingPosition.left}px`;
            floatBall.style.top = `${pendingPosition.top}px`;
            pendingPosition = null;
        }

        if (!isDragging) return;
        isDragging = false;
        floatBall.style.cursor = 'grab';
        setFloatBallSelectionDisabled(false);

        if (hasMoved) {
            persistFloatBallPosition(floatBall);
        } else if (e && e.type === 'touchend') {
            // On touch devices, preventDefault on touchstart suppresses the
            // synthesized click event, so we handle tap here directly.
            window.showYinXiaoSettingsPanel();
        }

        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchend', dragEnd);
    };

    floatBall.addEventListener('mousedown', dragStart);
    floatBall.addEventListener('touchstart', dragStart, { passive: false });

    floatBall.addEventListener('click', () => {
        if (!hasMoved) {
            window.showYinXiaoSettingsPanel();
        }
    });

    $('#enable_float_ball').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].enable_float_ball = $(event.target).prop('checked');
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_bg_color').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].float_ball_bg_color = $(event.target).val();
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_icon_color').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].float_ball_icon_color = $(event.target).val();
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_opacity').off('input').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#float_ball_opacity_value').val(value.toFixed(1));
        extension_settings[immersiveSoundExtensionName].float_ball_opacity = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_opacity_value').off('input').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#float_ball_opacity').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_opacity = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });

    $('#float_ball_size').off('input').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#float_ball_size_value').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_size = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_size_value').off('input').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#float_ball_size').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_size = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });

    applyFloatBallSettings();
    
    window.addEventListener('resize', () => {
        if (extension_settings[immersiveSoundExtensionName].enable_float_ball) {
            const ball = document.getElementById('st-is-float-ball');
            if (!ball) return;

            const rect = ball.getBoundingClientRect();
            const nextPosition = clampFloatBallPosition(rect.left, rect.top, rect.width, rect.height);

            ball.style.left = `${nextPosition.left}px`;
            ball.style.top = `${nextPosition.top}px`;

            persistFloatBallPosition(ball);
        }
    });
}

export { floatBallStateManager };
