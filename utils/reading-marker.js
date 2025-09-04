import { playList } from './playback.js';

class CharacterReadingMarker {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      charactersPerMinute: options.cpm || 600,
      highlightColor: options.highlightColor || 'rgba(255, 255, 0, 0.5)',
      textColor: options.textColor || '#ff0000',
      skipSpaces: options.skipSpaces !== false,
      startNode: options.startNode || null,
      startOffset: options.startOffset || 0,
      onComplete: options.onComplete || (() => {}),
      musicList: options.musicList || [],
    };
    
    this.isSupported = CSS.highlights && typeof Highlight !== 'undefined';
    if (!this.isSupported) {
        console.warn("CSS Custom Highlight API not supported. Reading marker will not function.");
    }

    this.delay = 60000 / this.options.charactersPerMinute;
    this.currentIndex = 0;
    this.startingIndex = 0;
    this.charPositions = [];
    this.isPlaying = false;
    this.animationFrameId = null;
    this.highlight = null;
    this.timePaused = 0;
    
    this.init();
  }

  init() {
    this.addStyles();
    if (this.isSupported) {
        if (!CSS.highlights.has('reading-highlight')) {
            CSS.highlights.set('reading-highlight', new Highlight());
        }
        this.highlight = CSS.highlights.get('reading-highlight');
    }
  }


  collectCharacterPositions() {
    this.charPositions = [];
    this.startingIndex = 0;

    const walker = document.createTreeWalker(
      this.element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let globalCharIndex = 0;
    let foundStart = !this.options.startNode;
    let nodeIndex = 0;
    let node;

    while (node = walker.nextNode()) {
        const text = node.textContent;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (!foundStart && node === this.options.startNode && i === this.options.startOffset) {
                this.startingIndex = this.charPositions.length;
                foundStart = true;
            }

            if (this.options.skipSpaces && /\s/.test(char)) {
                globalCharIndex++;
                continue;
            }

            this.charPositions.push({
                char: char,
                node: node,
                offset: i,
                globalIndex: globalCharIndex,
                nodeIndex: nodeIndex,
                parentTag: node.parentNode.tagName
            });
            globalCharIndex++;
        }
        nodeIndex++;
    }

    console.log(`收集完成: ${this.charPositions.length} 个字符（跳过空格: ${this.options.skipSpaces}）`);
  }


  animationLoop(timestamp) {
    if (!this.isPlaying) return;

    const elapsedTime = timestamp - this.startTime;
    const expectedCharArrIndex = this.startingIndex + Math.floor(elapsedTime / this.delay);

    if (expectedCharArrIndex >= this.charPositions.length) {
        this.stop();
        if (this.options.onComplete) {
            this.options.onComplete();
        }
        return;
    }

    if (expectedCharArrIndex > this.currentIndex) {
        this.currentIndex = expectedCharArrIndex;
        
        if (this.isSupported) {
            this.highlight.clear();
            const currentCharData = this.charPositions[this.currentIndex];
            if (currentCharData) {
                const { node, offset } = currentCharData;
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                this.highlight.add(range);
                playList(currentCharData.globalIndex, this.options.musicList, this);
            }
        }
        
    }

    this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
  }


  getCharacterPosition(index) {
    if (index < 0 || index >= this.charPositions.length) return null;
    
    const charData = this.charPositions[index];
    const { node, offset, char } = charData;

    if (!document.body.contains(node) || node.textContent.length <= offset) {
        return null;
    }

    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    
    return {
      char: char, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      bottom: rect.bottom, right: rect.right, visible: this.isCharacterVisible(rect)
    };
  }

  isCharacterVisible(rect) {
    const buffer = 50;
    return rect.top >= -buffer && 
           rect.bottom <= window.innerHeight + buffer &&
           rect.left >= -buffer && 
           rect.right <= window.innerWidth + buffer &&
           rect.width > 0 && 
           rect.height > 0;
  }

  start() {
    if (!this.isSupported) return;
    if (this.isPlaying) this.stop();
    
    this.isPlaying = true;
    this.collectCharacterPositions();
    this.currentIndex = this.startingIndex || 0;
    
    this.startTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));

    console.log(`开始逐字阅读，速度: ${this.options.charactersPerMinute} 字/分钟`);
  }

  addStyles() {
    let style = document.getElementById('char-reading-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'char-reading-styles';
        document.head.appendChild(style);
    }
    this.styleSheet = style.sheet;

    // Clear existing rules
    while (this.styleSheet.cssRules.length > 0) {
        this.styleSheet.deleteRule(0);
    }

    // Add new rule for CSS Custom Highlights
    const rule = `
      ::highlight(reading-highlight) {
        background-color: ${this.options.highlightColor};
        color: ${this.options.textColor};
      }
    `;
    this.styleSheet.insertRule(rule, 0);
  }

  pause() {
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
    this.isPlaying = false;
    this.timePaused = performance.now();
  }

  resume() {
    if (!this.isSupported) return;
    if (!this.isPlaying && this.currentIndex < this.charPositions.length) {
        this.isPlaying = true;
        this.startTime += (performance.now() - this.timePaused);
        this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
    }
  }

  stop() {
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
    this.isPlaying = false;

    if (this.isSupported && this.highlight) {
        this.highlight.clear();
    }

    this.currentIndex = 0;
  }

  setSpeed(charactersPerMinute) {
    this.options.charactersPerMinute = charactersPerMinute;
    this.delay = 60000 / charactersPerMinute;
    
    if (this.isPlaying) {
      this.pause();
      this.resume();
    }
  }

  destroy() {
    this.stop();
    if (this.isSupported) {
        CSS.highlights.delete('reading-highlight');
    }
    const style = document.getElementById('char-reading-styles');
    if (style) style.remove();
  }
}

export { CharacterReadingMarker };
