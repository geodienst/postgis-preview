jQuery.fn.resizable = function(options) {
  if (!options)
    options = {};

  function clamp(preferred, min, max) {
    return Math.min(max, Math.max(preferred, min));
  }

  return $(this).each(function() {
    const area = $(this);
    const handle = area.children('.resize-handle');
    const axis = handle.is('.vertical') ? 'height' : 'width';
    const eventAxis = axis == 'width' ? 'clientX' : 'clientY';
    const min = options.min || (() => 0);
    const max = options.max || (() => Infinity);

    let pos = null;
    let size = null;
    
    function setSize(preferred, store) {
      const size = clamp(preferred, min(), max());
      area[axis](size);
      
      if (options.callback)
        options.callback.call(area.get(0), size);
      
      if (store)
        window.localStorage[name + '_' + axis] = size;
    }

    handle.on('mousedown', function(e) {
      pos = e[eventAxis];
      size = area[axis]();
      handle.addClass('active');
      e.preventDefault();
    });

    $(document.body).on('mouseup', function(e) {
      if (pos !== null) {
        pos = null;
        handle.removeClass('active');
        e.preventDefault();
      }
    });

    $(document.body).on('mousemove', function(e) {
      if (pos !== null) {
        const newSize = options.inverse
          ? (size - (e[eventAxis] - pos))
          : (size + (e[eventAxis] - pos));
        setSize(newSize, true);
        e.preventDefault();
      }
    });

    if (window.localStorage[name + '_' + axis] !== undefined)
      setSize(window.localStorage[name + '_' + axis]);
  });
}