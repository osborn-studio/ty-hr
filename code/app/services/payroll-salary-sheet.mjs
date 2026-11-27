// Parse only the caller's uploaded values. No employee lookup or database write.
// Matching, complete authorization and salary CAS happen in profiles.preview/save.
import{readNamedWorkbook,columnName}from'./customer-performance-import.mjs';
import{bad}from'./platform-core.mjs';
export function salarySheet(_t,{input}){
 if(!/\.xlsx$/i.test(String(input.filename||''))||typeof input.content_base64!=='string'||input.content_base64.length>2800000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content_base64))bad('请选择不超过2MB的XLSX工资明细');
 const buffer=Buffer.from(input.content_base64,'base64');if(buffer.length>2*1024*1024)bad('工资明细文件不超过2MB');
 const book=readNamedWorkbook(buffer);if(!book)bad('无法读取XLSX工资明细');
 if(book.external_relationship_count||book.formula_count||book.errors.length)bad('工资标准导入只接受明确数值，请先将公式转为值并移除外部链接和错误单元格');
 const sheets=book.sheets.filter(s=>!s.hidden&&s.max_row>0),sheet=input.sheet_name?sheets.find(s=>s.name===input.sheet_name):sheets.length===1?sheets[0]:null;
 if(!sheet)bad('工资明细须只有一个可见数据工作表，或明确指定工作表名称');
 if(sheet.max_row>201||sheet.max_column>100)bad('一次最多200名员工、100列工资明细');
 const quoted=value=>'"'+String(value??'').replaceAll('"','""')+'"';
 const rows=[];for(let row=1;row<=sheet.max_row;row++){const values=[];for(let col=1;col<=sheet.max_column;col++){const c=sheet.cells.get(columnName(col)+row);values.push(c?.cell_type==='n'||c&&!['s','inlineStr','str','e'].includes(c.cell_type)?c.raw_value_text??c.value??'':c?.value??'');}if(values.some(v=>String(v).trim()))rows.push(values.map(quoted).join('\t'));}
 if(rows.length<2)bad('工资明细须包含表头及至少一名员工');return{text:rows.join('\n'),rows:rows.length-1,sheet_name:sheet.name};
}
