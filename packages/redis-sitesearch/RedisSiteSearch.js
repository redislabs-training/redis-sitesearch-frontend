import AutocompleteCore from './AutocompleteCore.js'
import uniqueId from './util/uniqueId.js'
import getRelativePosition from './util/getRelativePosition.js'
import debounce from './util/debounce.js'

// Creates a props object with overridden toString function. toString returns an attributes
// string in the format: `key1="value1" key2="value2"` for easy use in an HTML string.
class Props {
  constructor(index, selectedIndex, baseClass) {
    this.id = `${baseClass}-result-${index}`
    this.class = `${baseClass}-result`
    this['data-result-index'] = index
    this['tabindex'] = index
    this.role = 'option'
    if (index === selectedIndex) {
      this['aria-selected'] = 'true'
    }
  }

  toString() {
    return Object.keys(this).reduce(
      (str, key) => `${str} ${key}="${this[key]}"`,
      ''
    )
  }
}

class RedisSiteSearch {
  expanded = false
  loading = false
  position = {}
  resetPosition = true

  constructor(
    root,
    {
      search,
      onSubmit = () => {},
      onUpdate = () => {},
      baseClass = 'redis-sitesearch',
      autoSelect,
      getResultValue = result => result,
      renderResult,
      debounceTime = 0,
    } = {}
  ) {
    this.root = typeof root === 'string' ? document.querySelector(root) : root
    this.input = this.root.querySelector('input')
    this.resultList = this.root.querySelector('ul')
    this.baseClass = baseClass
    this.getResultValue = getResultValue
    this.onUpdate = onUpdate
    if (typeof renderResult === 'function') {
      this.renderResult = renderResult
    }

    const core = new AutocompleteCore({
      search,
      autoSelect,
      setValue: this.setValue,
      setAttribute: this.setAttribute,
      onUpdate: this.handleUpdate,
      onSubmit,
      onShow: this.handleShow,
      onHide: this.handleHide,
      onLoading: this.handleLoading,
      onLoaded: this.handleLoaded,
    })
    if (debounceTime > 0) {
      core.handleInput = debounce(core.handleInput, debounceTime)
    }
    this.core = core

    this.resultContainer = this.root.querySelector(
      '.redis-sitesearch-result-list-wrapper'
    )
    this.resultContainer.style.position = 'absolute'
    this.resultContainer.style['z-index'] = '1'
    this.resultContainer.style.width = '100%'
    this.resultContainer.style['box-sizing'] = 'border-box'
    this.resultContainer.style.visibility = 'hidden'
    this.resultContainer.style['pointer-events'] = 'none'
    this.resultContainer.style.bottom = '100%'

    this.redisearchLogo = this.root.querySelector('.redisearch-logo')

    this.initialize()
  }

  // Set up aria attributes and events
  initialize = () => {
    this.root.style.position = 'relative'

    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('redis-sitesearch', 'off')
    this.input.setAttribute('autocapitalize', 'off')
    this.input.setAttribute('autocorrect', 'off')
    this.input.setAttribute('spellcheck', 'false')
    this.input.setAttribute('aria-redis-sitesearch', 'list')
    this.input.setAttribute('aria-haspopup', 'listbox')
    this.input.setAttribute('aria-expanded', 'false')

    this.resultList.setAttribute('role', 'listbox')

    this.resultContainer.style.position = 'absolute'
    this.resultContainer.style.zIndex = '1'
    this.resultContainer.style.width = '100%'
    this.resultContainer.style.boxSizing = 'border-box'

    // Generate ID for results list if it doesn't have one
    if (!this.resultList.id) {
      this.resultList.id = uniqueId(`${this.baseClass}-result-list-`)
    }

    this.input.setAttribute('aria-owns', this.resultList.id)

    document.body.addEventListener('click', this.handleDocumentClick)
    this.input.addEventListener('keydown', this.handleKeyDown)
    this.input.addEventListener('input', this.core.handleInput)
    this.input.addEventListener('focus', this.core.handleFocus)
    this.resultList.addEventListener(
      'mousedown',
      this.core.handleResultMouseDown
    )
    this.resultList.addEventListener('click', this.core.handleResultClick)

    this.updateStyle()
  }

  updateStyle = () => {
    this.root.dataset.expanded = this.expanded
    this.root.dataset.loading = this.loading
    this.root.dataset.position = this.position

    this.resultContainer.style.visibility = this.expanded ? 'visible' : 'hidden'
    this.resultContainer.style.pointerEvents = this.expanded ? 'auto' : 'none'
    if (this.position === 'below') {
      this.resultContainer.style.bottom = null
      this.resultContainer.style.top = '100%'
    } else {
      this.resultContainer.style.top = null
      this.resultContainer.style.bottom = '100%'
    }
  }

  handleKeyDown = event => {
    const { key } = event

    switch (key) {
      case 'Up': // IE/Edge
      case 'Down': // IE/Edge
      case 'ArrowUp':
      case 'ArrowDown': {
        const selectedIndex =
          key === 'ArrowUp' || key === 'Up'
            ? this.core.selectedIndex - 1
            : this.core.selectedIndex + 1
        event.preventDefault()
        this.core.handleArrows(selectedIndex)
        break
      }
      case 'Tab': {
        this.core.selectResult()
        break
      }
      case 'Enter': {
        const selectedResult = this.core.results[this.core.selectedIndex]

        // Avoid closing the search box on Enter if a result is not selected.
        if (!selectedResult) {
          return
        }

        this.core.selectResult()
        this.core.onSubmit(selectedResult)
        break
      }
      case 'Esc': // IE/Edge
      case 'Escape': {
        this.core.hideResults()
        this.core.setValue()
        break
      }
      default:
        return
    }
  }

  setAttribute = (attribute, value) => {
    this.input.setAttribute(attribute, value)
  }

  setValue = result => {
    this.input.value = result ? this.getResultValue(result) : ''
  }

  renderResult = (result, props, index) =>
    `<li ${props}>${this.getResultValue(result, index)}</li>`

  organizeResultsBySection = results => {
    var topLevelNodes = {},
      topLevelOrder = []

    // Given an array of document (web site) results ordered by score, each of
    // which contains a title, hierarchy, etc., we need to create a new data
    // structure that looks like this:
    //
    // {
    //   "Title of a root page in the site hierarchy": {
    //     "Title of a page": [
    //      {}, {}, {}  // Results for the page: could be the entire page, or multiple H2s.
    //   }
    // }
    //
    // When we render this data, we want to render the top-level sections in the
    // order in which we encountered them in the original results array, so we
    // maintain a "topLevelOrder" array to hold that order.
    //
    results.forEach(result => {
      let rootName = result.hierarchy[0],
        secondLevelName =
          result.hierarchy.length > 1
            ? result.hierarchy[1]
            : result.hierarchy[0],
        root = topLevelNodes[rootName]

      if (root === undefined) {
        let newRoot = {
          name: rootName,
          secondLevelOrder: [secondLevelName],
        }
        newRoot[secondLevelName] = [result]
        topLevelNodes[rootName] = newRoot
        topLevelOrder.push(rootName)
      } else {
        if (!root.hasOwnProperty(secondLevelName)) {
          root[secondLevelName] = []
          root.secondLevelOrder.push(secondLevelName)
        }
        root[secondLevelName].push(result)
      }
    })

    return {
      topLevelNodes: topLevelNodes,
      topLevelOrder: topLevelOrder,
    }
  }

  handleUpdate = (results, selectedIndex) => {
    this.resultList.innerHTML = ''
    var idx = -1,
      resultsInOrderOfAppearance = []

    let resultsBySection = this.organizeResultsBySection(results)

    resultsBySection.topLevelOrder.forEach(topLevelNodeName => {
      let topLevelNode = resultsBySection.topLevelNodes[topLevelNodeName]

      this.resultList.insertAdjacentHTML(
        'beforeend',
        `
        <li class="search-root-item">
          <div class="search-root">
            ${topLevelNodeName}
          </div>
        </li>
      `
      )
      topLevelNode.secondLevelOrder.forEach(sectionName => {
        let secondLevel = topLevelNode[sectionName]

        secondLevel.forEach(result => {
          idx += 1
          let props = new Props(idx, selectedIndex, this.baseClass)
          // Use the total ordering index (idx) when rendering, rather than
          // the index of this item within the section.
          const resultHTML = this.renderResult(result, props, idx)
          if (typeof resultHTML === 'string') {
            this.resultList.insertAdjacentHTML('beforeend', resultHTML)
          } else {
            this.resultList.insertAdjacentElement('beforeend', resultHTML)
          }
          resultsInOrderOfAppearance.push(result)
        })
      })
    })

    // The docs in the response are ordered by score, not by section. We need to
    // reorder them by section (the order that the user sees) so that when we
    // when the user clicks or presses enter on item 2 in the list, we can look
    // up the record at index 2 and find the same item.
    this.core.results = resultsInOrderOfAppearance
    results = resultsInOrderOfAppearance

    this.input.setAttribute(
      'aria-activedescendant',
      selectedIndex > -1 ? `${this.baseClass}-result-${selectedIndex}` : ''
    )

    if (this.resetPosition) {
      this.resetPosition = false
      this.position = getRelativePosition(this.input, this.resultList)
      this.updateStyle()
    }
    this.core.checkSelectedResultVisible(this.resultList)
    this.onUpdate(results, selectedIndex)
  }

  handleShow = () => {
    this.expanded = true
    this.updateStyle()
  }

  handleHide = () => {
    this.expanded = false
    this.resetPosition = true
    this.updateStyle()
  }

  handleLoading = () => {
    this.loading = true
    this.updateStyle()
  }

  handleLoaded = () => {
    this.loading = false
    this.updateStyle()
  }

  handleDocumentClick = event => {
    if (event.target) {
      if (this.root.contains(event.target)) {
        return
      }
    }
    this.core.hideResults()
  }

  updateStyle = () => {
    this.root.dataset.expanded = this.expanded
    this.root.dataset.loading = this.loading
    this.root.dataset.position = this.position

    this.resultContainer.style.visibility = this.expanded ? 'visible' : 'hidden'
    this.resultContainer.style.pointerEvents = this.expanded ? 'auto' : 'none'
    if (this.position === 'below') {
      this.resultContainer.style.bottom = null
      this.resultContainer.style.top = '100%'
    } else {
      this.resultContainer.style.top = null
      this.resultContainer.style.bottom = '100%'
    }
  }
}

export default RedisSiteSearch
