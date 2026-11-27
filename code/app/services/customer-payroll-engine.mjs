// Customer payroll: exact decimal arithmetic and a deliberately small formula language.
// Workbook cached amounts are evidence; this engine never evaluates Excel or JavaScript.
const fail = message => {
  throw new Error(message);
};
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1n;
};

function rational(n, d = 1n) {
  if (!d) fail('除数不能为零');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  n /= g;
  d /= g;
  if (n.toString().length > 90 || d.toString().length > 90) fail('数值超出计算范围');
  return {
    n,
    d
  };
}
export function decimal(value) {
  if (value && typeof value === 'object' && typeof value.n === 'bigint') return value;
  if (typeof value !== 'string' && typeof value !== 'number') fail('需要明确的数值');
  const s = String(value).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m || s.length > 70) fail('无效数值');
  const exp = Number(m[4] || 0) - (m[3] || '').length;
  if (Math.abs(exp) > 30) fail('数值精度超限');
  const n = BigInt((m[1] === '-' ? '-' : '') + m[2] + (m[3] || ''));
  return exp >= 0 ? rational(n * 10n ** BigInt(exp)) : rational(n, 10n ** BigInt(-exp));
}
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rational(a.n * b.n, a.d * b.d);
const div = (a, b) => rational(a.n * b.d, a.d * b.n);
const cmp = (a, b) => a.n * b.d - b.n * a.d;

function rounded(a, places = 2) {
  if (!Number.isInteger(places) || places < 0 || places > 8) fail('ROUND小数位须为0至8');
  const scale = 10n ** BigInt(places),
    n = a.n * scale,
    sign = n < 0n ? -1n : 1n,
    v = n < 0n ? -n : n;
  return rational(sign * (v / a.d + (v % a.d * 2n >= a.d ? 1n : 0n)), scale);
}
export function money(value) {
  const a = rounded(decimal(value)),
    negative = a.n < 0n,
    n = (negative ? -a.n : a.n) * 100n / a.d;
  return (negative ? '-' : '') + String(n / 100n) + '.' + String(n % 100n).padStart(2, '0');
}
export const SUPPORTED_OPERATORS = ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'if', 'eq', 'ne',
  'lt', 'lte', 'gt', 'gte', 'and', 'or', 'round', 'ceil','floor','abs','sqrt','power','mod','greatest','least','coalesce','max0','min0','prorata','not'
];
const arity = {
  add: [2, 20],
  subtract: [2, 2],
  multiply: [2, 20],
  divide: [2, 2],
  min: [1, 20],
  max: [1, 20],
  if: [3, 3],
  eq: [2, 2],
  ne: [2, 2],
  lt: [2, 2],
  lte: [2, 2],
  gt: [2, 2],
  gte: [2, 2],
  and: [2, 20],
  or: [2, 20],
  ceil:[1,1],floor:[1,1],abs:[1,1],sqrt:[1,1],power:[2,2],mod:[2,2],greatest:[1,20],least:[1,20],coalesce:[1,20],max0:[1,1],min0:[1,1],prorata:[3,3],not:[1,1],
  round: [1, 2]
};
export function validateFormula(ast) {
  let count = 0;

  function walk(n, depth) {
    if (++count > 300 || depth > 30) fail('表达式过长');
    if (typeof n === 'number') {
      decimal(n);
      return;
    }
    if (typeof n === 'string' || typeof n === 'boolean') return;
    if (!n || Array.isArray(n) || typeof n !== 'object') fail('无效公式节点');
    if (Object.hasOwn(n, 'var')) {
      if (Object.keys(n).length !== 1 || typeof n.var!=='string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n.var)) fail('无效变量名');
      return;
    }
    const range = arity[n.op];
    if (!range || Object.keys(n).some(k => !['op', 'args'].includes(k)) || !Array.isArray(n.args) || n.args
      .length < range[0] || n.args.length > range[1]) fail('不支持的操作或参数数量');
    n.args.forEach(a => walk(a, depth + 1));
  }
  walk(ast, 0);
  return ast;
}
// Pratt parser. Only tokens listed here can enter the AST; there is no eval.
export function parseFormula(text) {
  if (typeof text !== 'string' || text.length > 4000) fail('公式过长');
  const s = text.trim().replace(/^=/, '');
  const tokens = [];
  let pos = 0;
  while (pos < s.length) {
    const m =
      /^\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|("(?:[^"\\]|\\["\\])*"|'(?:[^'\\]|\\['\\])*')|(<=|>=|!=|==|<>|[+\-*/(),<>=]))/i
      .exec(s.slice(pos));
    if (!m) fail('公式包含不支持的字符');
    tokens.push(m[1] ? {
      type: 'num',
      value: m[1]
    } : m[2] ? {
      type: 'id',
      value: m[2]
    } : m[3] ? {
      type: 'str',
      value: m[3].slice(1, -1).replace(/\\(['"\\])/g, '$1')
    } : {
      type: 'op',
      value: m[4]
    });
    pos += m[0].length;
  }
  let i = 0;
  const take = () => tokens[i++],
    peek = () => /^(and|or)$/i.test(tokens[i]?.value||'')?tokens[i].value.toUpperCase():tokens[i]?.value;
  const prec = {
    OR: -2, AND: -1,
    '=': 1,
    '==': 1,
    '!=': 1,
    '<>': 1,
    '<': 1,
    '<=': 1,
    '>': 1,
    '>=': 1,
    '+': 2,
    '-': 2,
    '*': 3,
    '/': 3
  };
  const names = {
    OR: 'or', AND: 'and',
    '+': 'add',
    '-': 'subtract',
    '*': 'multiply',
    '/': 'divide',
    '=': 'eq',
    '==': 'eq',
    '!=': 'ne',
    '<>': 'ne',
    '<': 'lt',
    '<=': 'lte',
    '>': 'gt',
    '>=': 'gte'
  };

  function expr(min = -2) {
    let t = take(),
      left;
    if (!t) fail('公式不完整');
    if (t.value === '-') left = {
      op: 'subtract',
      args: [0, expr(4)]
    };
    else if (t.value === '+') left = expr(4);
    else if (t.value === '(') {
      left = expr();
      if (take()?.value !== ')') fail('缺少右括号');
    } else if (t.type === 'num') left = t.value;
    else if (t.type === 'str') left = t.value;
    else if (t.type === 'id') {
      if(/^not$/i.test(t.value)&&peek()!=='(')left={op:'not',args:[expr(0)]};
      else if (peek() === '(') {
        take();
        const args = [];
        if (peek() !== ')') {
          for (;;) {
            args.push(expr());
            if (peek() !== ',') break;
            take();
          }
        }
        if (take()?.value !== ')') fail('缺少右括号');
        left = {
          op: t.value.toLowerCase(),
          args
        };
      } else left = /^(true|false)$/i.test(t.value) ? t.value.toLowerCase() === 'true' : {
        var: t.value
      };
    } else fail('无效公式');
    while (prec[peek()] >= min) {
      const op = take().value;
      left = {
        op: names[op]||names[op.toUpperCase()],
        args: [left, expr(prec[op] + 1)]
      };
    }
    return left;
  }
  const ast = expr();
  if (i !== tokens.length) fail('公式有多余内容');
  return validateFormula(ast);
}
export function evaluateFormula(ast, inputs, {onRead}={}) {
  validateFormula(ast);
  let count = 0;
  const truth = v => {
    if (typeof v !== 'boolean') fail('条件需要明确真假');
    return v;
  };

  function run(n) {
    if (++count > 500) fail('计算节点超限');
    if (typeof n !== 'object' || n === null) return n;
    if (n.var) {
      onRead?.(n.var);
      if (!Object.hasOwn(inputs, n.var) || inputs[n.var] === null || inputs[n.var] === '') fail('缺少输入：' + n
        .var);
      return inputs[n.var];
    }
    const op = n.op,
      a = n.args;
    if (op === 'if') return run(a[truth(run(a[0])) ? 1 : 2]);
    if (op === 'and') return a.every(x => truth(run(x)));
    if (op === 'or') return a.some(x => truth(run(x)));
    if(op==='not')return !truth(run(a[0]));
    if(op==='coalesce'){for(const x of a){const v=run(x);if(v!==null&&v!==undefined&&v!=='')return v;}fail('COALESCE no known value');}
    const v = a.map(run);
    if (op === 'eq' || op === 'ne') {
      let equal;
      try {
        equal = cmp(decimal(v[0]), decimal(v[1])) === 0n;
      } catch {
        equal = typeof v[0] === typeof v[1] && v[0] === v[1];
      }
      return op === 'eq' ? equal : !equal;
    }
    const d = v.map(decimal);
    switch (op) {
      case 'add':
        return d.reduce(add);
      case 'subtract':
        return sub(...d);
      case 'multiply':
        return d.reduce(mul);
      case 'divide':
        return div(...d);
      case 'greatest':return d.reduce((x,y)=>cmp(x,y)>0n?x:y);
      case 'least':return d.reduce((x,y)=>cmp(x,y)<0n?x:y);
      case 'abs':return rational(d[0].n<0n?-d[0].n:d[0].n,d[0].d);
      case 'ceil':return rational(d[0].n/d[0].d+(d[0].n>0n&&d[0].n%d[0].d?1n:0n));
      case 'floor':return rational(d[0].n/d[0].d-(d[0].n<0n&&d[0].n%d[0].d?1n:0n));
      case 'max0':return d[0].n<0n?rational(0n):d[0];
      case 'min0':return d[0].n>0n?rational(0n):d[0];
      case 'prorata':return div(mul(d[0],d[1]),d[2]);
      case 'mod':{const quotient=div(d[0],d[1]);return sub(d[0],mul(rational(quotient.n/quotient.d),d[1]));}
      case 'power':{if(d[1].n%d[1].d)fail('POWER exponent must be integer');const e=d[1].n/d[1].d;if(e>16n||e< -16n)fail('POWER exponent limit -16..16');if(d[0].n===0n&&e<=0n)fail('POWER zero base');const n=e<0n?-e:e;return e<0n?rational(d[0].d**n,d[0].n**n):rational(d[0].n**n,d[0].d**n);}
      case 'sqrt':{if(d[0].n<0n)fail('SQRT negative input');const root=n=>{if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n;}return x;};const n=root(d[0].n),den=root(d[0].d);if(n*n!==d[0].n||den*den!==d[0].d)fail('SQRT requires an exact rational result');return rational(n,den);}
      case 'min':
        return d.reduce((x, y) => cmp(x, y) < 0n ? x : y);
      case 'max':
        return d.reduce((x, y) => cmp(x, y) > 0n ? x : y);
      case 'lt':
        return cmp(...d) < 0n;
      case 'lte':
        return cmp(...d) <= 0n;
      case 'gt':
        return cmp(...d) > 0n;
      case 'gte':
        return cmp(...d) >= 0n;
      case 'round':
        if(v.length===2&&d[1].n%d[1].d!==0n)fail('ROUND小数位须为整数');
        return rounded(d[0], v.length === 1 ? 2 : Number(d[1].n/d[1].d));
      default:
        fail('不支持的计算');
    }
  }
  return run(ast);
}
export function totals(items) {
  const result = {
    income_total: '0.00',
    deduction_total: '0.00',
    employee_contribution: '0.00',
    employer_contribution: '0.00'
  };
  const byKind = {
    earning: 'income_total',
    deduction: 'deduction_total',
    employee_contribution: 'employee_contribution',
    employer_contribution: 'employer_contribution'
  };
  for (const item of items) {
    const k = byKind[item.kind];
    if (k) result[k] = money(add(decimal(result[k]), decimal(item.amount)));
  }
  result.payable_gross = money(sub(decimal(result.income_total), decimal(result.deduction_total)));
  result.net_pay = money(sub(decimal(result.payable_gross), decimal(result.employee_contribution)));
  result.employer_cost = money(add(decimal(result.payable_gross), decimal(result.employer_contribution)));
  return result;
}
export function calculate(rules, inputs, {onRead}={}) {
  const items = [],
    context = {
      ...inputs
    };
  const derived=new Set();
  for (const rule of rules) {
    const amount = money(evaluateFormula(rule.formula, context,{onRead:key=>{if(!derived.has(key))onRead?.(key);}}));
    items.push({
      code: rule.code,
      name: rule.name,
      kind: rule.kind,
      amount
    });
    context[rule.code] = amount;
    derived.add(rule.code);
  }
  return {
    items,
    totals: totals(items)
  };
}
export function difference(a, b) {
  return money(sub(decimal(a), decimal(b)));
}
