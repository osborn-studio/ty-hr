export const FORMULA_FUNCTIONS=[
 ['if','if(条件, 真值, 假值)','条件','if(monthly >= 10000, monthly * 0.1, monthly * 0.05)'],
 ['round','round(金额, 小数位)','四舍五入，省略小数位沿用新版默认2位','round(monthly / 3, 2)'],
 ['ceil','ceil(数值)','向上取整','ceil(monthly / 1000)'],['floor','floor(数值)','向下取整','floor(monthly / 1000)'],['abs','abs(数值)','绝对值','abs(monthly - 5000)'],
 ['sqrt','sqrt(数值)','平方根，仅允许精确有理数结果','sqrt(144)'],['power','power(数值, 整数指数)','整数幂，指数范围-16至16','power(1.05, 2)'],['mod','mod(数值, 除数)','余数，符号随被除数','mod(17, 5)'],
 ['min','min(a, b, ...)','取最小值','min(monthly, 5000)'],['max','max(a, b, ...)','取最大值','max(monthly, 5000)'],['greatest','greatest(a, b, ...)','多个数取最大值','greatest(monthly, 5000, 6000)'],['least','least(a, b, ...)','多个数取最小值','least(monthly, 5000, 6000)'],
 ['coalesce','coalesce(a, b, ...)','取首个明确非空值；未核数据仍须补核，不能吞掉缺失来源','coalesce(monthly, 0)'],['max0','max0(数值)','小于0按0','max0(monthly - 5000)'],['min0','min0(数值)','大于0按0','min0(monthly - 5000)'],['prorata','prorata(金额, 实际, 应出)','金额乘实际除以应出，应出不能为0','prorata(monthly, present_days, work_days)'],
 ['and','and(条件, 条件, ...)','所有条件成立','and(monthly > 0, monthly < 10000)'],['or','or(条件, 条件, ...)','任一条件成立','or(monthly > 10000, monthly = 0)'],['not','not(条件)','逻辑取反','not(monthly > 10000)']
].map(([code,args,description,example])=>({code,args,description,example}));
