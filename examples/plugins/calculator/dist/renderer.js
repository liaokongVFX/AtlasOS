function N(r) {
  return typeof r == "object" && r !== null && !Array.isArray(r);
}
function R(r, e) {
  return { ...e, ...N(r?.state) ? r.state : {} };
}
const u = {
  display: "0",
  expression: "",
  storedValue: null,
  operator: null,
  waitingForOperand: !1
}, O = 12, E = /* @__PURE__ */ new Set(["+", "-", "*", "/"]), A = [
  "input",
  "textarea",
  "select",
  "button",
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  ".cm-editor",
  ".dialog-content",
  ".popover-content",
  ".menu-content",
  ".top-bar"
].join(",");
function v(r) {
  return typeof r == "string" && E.has(r);
}
function b(r) {
  const e = R(r, u);
  return {
    display: typeof e.display == "string" && e.display ? e.display : u.display,
    expression: typeof e.expression == "string" ? e.expression : u.expression,
    storedValue: typeof e.storedValue == "number" && Number.isFinite(e.storedValue) ? e.storedValue : null,
    operator: v(e.operator) ? e.operator : null,
    waitingForOperand: e.waitingForOperand === !0
  };
}
function V(r) {
  return typeof r == "number" && Number.isFinite(r) ? Math.min(16, Math.max(4, Math.round(r))) : O;
}
function c(r, e = O) {
  if (!Number.isFinite(r)) return "Error";
  const n = Number.parseFloat(r.toPrecision(e));
  return Math.abs(n) >= 1e12 || Math.abs(n) > 0 && Math.abs(n) < 1e-8 ? n.toExponential(8).replace(/\.?0+e/, "e") : String(n);
}
function D(r, e, n, o) {
  switch (e) {
    case "+":
      return c(r + n, o);
    case "-":
      return c(r - n, o);
    case "*":
      return c(r * n, o);
    case "/":
      return n === 0 ? "Error" : c(r / n, o);
  }
}
function g(r, e) {
  return c(r, e);
}
function T(r) {
  return r.expression ? r.operator && !r.waitingForOperand && r.display !== "Error" ? `${r.expression}${r.display}` : r.expression : "";
}
function L(r, e) {
  return r.display === "Error" ? { ...u, display: e } : r.waitingForOperand ? {
    ...r,
    display: e,
    expression: r.operator ? r.expression : "",
    waitingForOperand: !1
  } : {
    ...r,
    display: r.display === "0" ? e : `${r.display}${e}`
  };
}
function P(r) {
  return r.display === "Error" ? { ...u, display: "0." } : r.waitingForOperand ? {
    ...r,
    display: "0.",
    expression: r.operator ? r.expression : "",
    waitingForOperand: !1
  } : r.display.includes(".") ? r : { ...r, display: `${r.display}.` };
}
function F(r, e, n) {
  const o = Number(r.display);
  if (!Number.isFinite(o))
    return { ...u, operator: e === "=" ? null : e };
  if (r.storedValue === null || r.operator === null)
    return e === "=" ? {
      ...r,
      expression: "",
      storedValue: null,
      operator: null,
      waitingForOperand: !0
    } : {
      ...r,
      storedValue: o,
      operator: e,
      expression: `${g(o, n)}${e}`,
      waitingForOperand: !0
    };
  if (r.waitingForOperand)
    return e === "=" ? r : {
      ...r,
      operator: e,
      expression: `${g(r.storedValue, n)}${e}`
    };
  const t = D(r.storedValue, r.operator, o, n), l = Number(t), s = `${g(r.storedValue, n)}${r.operator}${g(o, n)}${e === "=" || !Number.isFinite(l) ? "=" : e}`;
  return {
    display: t,
    storedValue: e === "=" || !Number.isFinite(l) ? null : l,
    operator: e === "=" || !Number.isFinite(l) ? null : e,
    expression: e === "=" || !Number.isFinite(l) ? s : `${t}${e}`,
    waitingForOperand: !0
  };
}
function K(r, e, n) {
  if (/^\d$/.test(e)) return L(r, e);
  if (e === ".") return P(r);
  if (e === "C") return u;
  if (e === "<-")
    return r.display === "Error" ? u : r.waitingForOperand ? { ...r, display: "0", expression: r.operator ? r.expression : "", waitingForOperand: !1 } : { ...r, display: r.display.length > 1 ? r.display.slice(0, -1) : "0" };
  if (e === "+/-")
    return r.display === "0" || r.display === "Error" ? r : { ...r, display: r.display.startsWith("-") ? r.display.slice(1) : `-${r.display}`, expression: r.operator ? r.expression : "" };
  if (e === "%") {
    const o = Number(r.display);
    return Number.isFinite(o) ? { ...r, display: c(o / 100, n), expression: r.operator ? r.expression : "" } : r;
  }
  return e === "=" ? F(r, "=", n) : v(e) ? F(r, e, n) : r;
}
function k(r) {
  if (r.altKey || r.ctrlKey || r.metaKey) return null;
  if (/^\d$/.test(r.key)) return r.key;
  switch (r.key) {
    case ".":
    case "Decimal":
      return ".";
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
      return r.key;
    case "=":
    case "Enter":
      return "=";
    case "Backspace":
      return "<-";
    case "c":
    case "C":
      return "C";
    default:
      return null;
  }
}
function B(r, e) {
  return !(r instanceof Element) || e && r instanceof Node && e.contains(r) ? !1 : !!r.closest(A);
}
const M = (r) => {
  const { React: e } = r, n = e.createElement, { Calculator: o } = r.icons, t = {
    root: {
      display: "grid",
      gridTemplateRows: "minmax(92px, auto) 1fr",
      gap: "12px",
      height: "100%",
      padding: "12px",
      outline: 0,
      background: "var(--color-canvas)",
      color: "var(--color-ink)"
    },
    screen: {
      display: "grid",
      alignContent: "end",
      gap: "6px",
      minWidth: 0,
      border: "1px solid var(--color-hairline)",
      borderRadius: "var(--radius-lg)",
      padding: "12px",
      overflow: "hidden",
      background: "var(--color-surface-1)",
      boxShadow: "var(--edge-highlight)"
    },
    trail: {
      minHeight: "16px",
      overflow: "hidden",
      color: "var(--color-ink-tertiary)",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      textAlign: "right",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    display: {
      overflow: "hidden",
      color: "var(--color-ink)",
      fontFamily: "var(--font-mono)",
      fontSize: "32px",
      fontWeight: 600,
      lineHeight: 1.1,
      textAlign: "right",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    keypad: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gridAutoRows: "minmax(42px, 1fr)",
      gap: "8px",
      minHeight: 0
    },
    button: {
      minWidth: 0,
      border: "1px solid var(--color-hairline)",
      borderRadius: "var(--radius-md)",
      padding: 0,
      background: "var(--color-surface-2)",
      color: "var(--color-ink-muted)",
      font: "inherit",
      fontSize: "15px",
      fontWeight: 600,
      cursor: "pointer"
    },
    operation: {
      borderColor: "rgb(94 106 210 / 42%)",
      background: "var(--color-primary-soft)",
      color: "var(--color-primary-hover)"
    },
    equals: {
      borderColor: "var(--color-primary-hover)",
      background: "var(--color-primary)",
      color: "#fff"
    }
  };
  function l({ component: s, updateState: x, isCanvasInteracting: p = !1, isNodeSelected: d = !1 }) {
    const m = e.useRef(null), y = b(s), h = V(r.plugin.config.precision), $ = T(y), C = ["C", "+/-", "%", "/", "7", "8", "9", "*", "4", "5", "6", "-", "1", "2", "3", "+", "<-", "0", ".", "="], f = e.useCallback((i) => {
      x(K(y, i, h));
    }, [h, y, x]);
    e.useEffect(() => {
      if (!d || p) return;
      const i = window.requestAnimationFrame(() => {
        m.current?.focus({ preventScroll: !0 });
      });
      return () => window.cancelAnimationFrame(i);
    }, [s.id, p, d]);
    const S = e.useCallback(
      (i) => {
        if (i.nativeEvent.isComposing || !d || p) return;
        const a = k(i);
        a && (i.preventDefault(), i.stopPropagation(), f(a));
      },
      [p, d, f]
    );
    return e.useEffect(() => {
      if (!d || p) return;
      const i = (a) => {
        if (a.defaultPrevented || a.isComposing || B(a.target, m.current)) return;
        const w = k(a);
        w && (a.preventDefault(), a.stopPropagation(), a.stopImmediatePropagation(), f(w));
      };
      return window.addEventListener("keydown", i, !0), () => window.removeEventListener("keydown", i, !0);
    }, [p, d, f]), n(
      "div",
      {
        ref: m,
        style: t.root,
        tabIndex: -1,
        onKeyDownCapture: S,
        "aria-label": "Calculator"
      },
      n("div", { style: t.screen }, n("div", { style: t.trail }, $), n("div", { style: t.display }, y.display)),
      n(
        "div",
        { style: t.keypad, role: "group", "aria-label": "Calculator keypad" },
        ...C.map(
          (i) => n(
            "button",
            {
              key: i,
              type: "button",
              style: {
                ...t.button,
                ...E.has(i) || i === "%" || i === "+/-" ? t.operation : {},
                ...i === "=" ? t.equals : {}
              },
              onClick: () => f(i),
              "aria-label": i === "<-" ? "Backspace" : i
            },
            i
          )
        )
      )
    );
  }
  r.registerNode(
    {
      id: "calculator",
      icon: o,
      create: () => ({ state: u }),
      getDetail: (s) => b(s).display,
      getSubtitle: () => null,
      getSearchTokens: () => ["calculator", "math", "arithmetic"],
      Renderer: l
    }
  );
};
export {
  M as registerPlugin
};
