export function mountSelectors(root: HTMLElement) {
  root.querySelectorAll('select').forEach((select, index) => {
    const label = select.getAttribute('aria-label') || select.closest('label')?.textContent?.replace(select.textContent ?? '', '').trim() || '选择选项';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'selector-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.dataset.selector = select.id || select.name;
    const value = document.createElement('span');
    trigger.append(value);
    const sync = () => {
      value.textContent = select.multiple ? [...select.selectedOptions].filter((option) => option.value !== '').map((option) => option.textContent).join('、') || '不限' : select.selectedOptions[0]?.textContent ?? '请选择';
      trigger.setAttribute('aria-label', `${label}：${value.textContent}`);
      trigger.classList.toggle('placeholder', !select.multiple && select.value === '');
      trigger.disabled = select.disabled;
    };
    select.hidden = true;
    select.after(trigger);
    sync();
    select.addEventListener('change', sync);
    select.addEventListener('invalid', (event) => {
      event.preventDefault();
      trigger.setAttribute('aria-invalid', 'true');
      if (!root.querySelector('[aria-invalid="true"]:focus')) trigger.focus();
    });
    trigger.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'selector-sheet';
      dialog.setAttribute('aria-labelledby', `selector-title-${index}`);
      const heading = document.createElement('div');
      heading.className = 'selector-heading';
      const title = document.createElement('h3');
      title.id = `selector-title-${index}`;
      title.textContent = label;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = select.multiple ? 'selector-close selector-done' : 'selector-close';
      close.textContent = select.multiple ? '完成' : '×';
      close.setAttribute('aria-label', select.multiple ? '完成多选' : '关闭选择面板');
      close.onclick = () => dialog.close();
      heading.append(title, close);
      const list = document.createElement('div');
      list.className = 'selector-options';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      if (select.multiple) list.setAttribute('aria-multiselectable', 'true');
      const options = [...select.options].filter((option) => !option.disabled && !(select.required && option.value === ''));
      const buttons = options.map((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'selector-option';
        item.textContent = option.textContent;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.tabIndex = -1;
        item.onclick = () => {
          if (select.multiple) {
            if (option.value === '') options.forEach((value) => { value.selected = false; });
            else option.selected = !option.selected;
            const unrestricted = options.find((value) => value.value === '');
            if (unrestricted) unrestricted.selected = !options.some((value) => value.value !== '' && value.selected);
            buttons.forEach((button, i) => button.setAttribute('aria-selected', String(options[i]!.selected)));
            sync();
            return;
          }
          select.value = option.value;
          trigger.removeAttribute('aria-invalid');
          dialog.close();
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        };
        list.append(item);
        return item;
      });
      list.addEventListener('keydown', (event) => {
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next < 0 || !buttons[next]) return;
        event.preventDefault();
        buttons.forEach((button, i) => { button.tabIndex = i === next ? 0 : -1; });
        buttons[next].focus();
      });
      dialog.append(heading, list);
      document.body.append(dialog);
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY > bounds.bottom) dialog.close();
      });
      dialog.addEventListener('close', () => {
        document.body.classList.remove('selector-open');
        trigger.setAttribute('aria-expanded', 'false');
        dialog.remove();
        if (select.multiple) {
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
        else root.querySelector<HTMLButtonElement>('.selector-trigger')?.focus({ preventScroll: true });
      }, { once: true });
      trigger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('selector-open');
      dialog.showModal();
      const selected = buttons[options.findIndex((option) => option.selected)] ?? buttons[0];
      if (selected) {
        selected.tabIndex = 0;
        selected.focus({ preventScroll: true });
        selected.scrollIntoView({ block: 'nearest' });
      }
    });
  });
}
