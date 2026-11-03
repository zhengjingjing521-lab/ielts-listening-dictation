"""Write an Excel snapshot in memory. User-entered strings always remain text."""
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE


def export(report):
    workbook = Workbook()
    workbook.remove(workbook.active)
    layouts = [
        ('每日单词汇总', report['summary'],
         ['日期','单词','练习次数','正确次数','错误次数','拼写错误','未听出','当天第一次','最近一次','错误拼写记录'],
         ['day','word','attempts','correct','wrong','spelling','unheard','first','latest','examples']),
        ('每次作答明细', report['rows'],
         ['日期','时间（北京）','词表','分组','原词号','单词','当时输入','结果','具体差别','听过的音色','选中音色','方式','播放次数','记录编号'],
         ['day','time','unit','group','wordNumber','word','answer','result','error','heardVoices','voice','mode','plays','id'])
    ]
    for name, rows, headers, fields in layouts:
        sheet = workbook.create_sheet(name)
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(color='FFFFFF', bold=True)
            cell.fill = PatternFill('solid', fgColor='944566')
        for entry in rows:
            values = [entry[field] for field in fields]
            sheet.append([ILLEGAL_CHARACTERS_RE.sub('',v) if isinstance(v,str) else v for v in values])
            for cell, value in zip(sheet[sheet.max_row], values):
                if isinstance(value,str):
                    cell.data_type = 's'
                    cell.alignment = Alignment(vertical='top',wrap_text=True)
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        for i, field in enumerate(fields,1):
            sheet.column_dimensions[get_column_letter(i)].width = 40 if field in ('id','examples','error') else 24 if field=='time' else 16
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
