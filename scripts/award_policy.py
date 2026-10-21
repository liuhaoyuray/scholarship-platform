"""Classify documentary evidence, never infer receipt from eligibility or application."""
import re
LABELS={1:'获奖/发放依据',2:'资格、排名或名额参考',3:'申请、推荐或评审过程',4:'公示待确认',5:'未获奖或已撤回',6:'未找到明确获奖依据',7:'其他奖项或荣誉佐证'}
def norm(value):return re.sub(r'\s+','',str(value or '')).replace('％','%').replace('“','').replace('”','')
def explicit_award(award,text):
 a=norm(award);t=norm(text)
 aliases={'国家奖学金':['国奖'],'国家励志奖学金':['国励志','国励'],'九号奖学金':['九号公司奖学金'],'宝钢奖学金':['宝钢优秀学生奖'],'三星奖学金':['三星'],'少数民族生励志奋进奖学金':['少数民族励志奋进奖学金'],'优秀学生半脱产干部奖学金':['优秀半脱产学生干部奖学金']}
 return bool(a and (a in t or any(x in t for x in aliases.get(a,[]))))
def classify(row,source):
 path=source.get('path','');leaf=re.split(r'[\\/!]',path)[-1];sheet=str(row.get('locator','')).split(' · ')[0];context=norm(leaf+' '+sheet);stage=row.get('stage','')
 if stage=='未获奖/放弃':return 5
 # Eligibility and quota submissions can contain thousands of non-recipients.
 eligibility=r'前(?:百分之)?(?:50|５０|五十|30|３０|三十)(?:%|百分比)?|参评|参选资格|参评资格|资格审查|名额(?:测算|分配|统计)|人数(?:汇总|统计)|成绩排名|综合(?:成绩|排名)|专业排名|排名名单|在校生|挂科|违纪|基本信息|全体学生'
 if re.search(eligibility,context) or re.search(r'名额测算|前50[%％]|参评学生',path):return 2
 if stage=='参考材料':return 2
 if re.search(r'申请|推荐|初审|初评|评审表|评定表|候选|入围|答辩|拟获|拟奖|拟发放|拟推荐',context):return 3
 if '公示' in context or stage=='公示材料':return 4
 if stage=='申请/推荐':return 3
 summary=bool(re.search(r'奖学金(?:年终)?汇总表|各类资助明细汇总|资助(?:项目)?发放明细',context))
 payout=bool(re.search(r'发放(?:名单|明细|清单|表|汇总)|获奖(?:学生|人员|人)?(?:名单|名册|明细|信息表|信息汇总|情况表|情况汇总)|奖励发放',context))
 if re.search(r'发钱|发财务部|提交财务处发放说明',path) and re.search(r'名单|名册|明细|清单',context):payout=True
 if not(summary or payout):return 6
 # The surrounding application folder is not evidence of which prize was won.
 if not explicit_award(row.get('award'),leaf+' '+sheet):
  if not(summary and explicit_award(row.get('award'),row.get('excerpt',''))):return 7
 if norm(row.get('level')) in ['无','否','0','未获奖','未通过','放弃','取消']:return 5
 return 1
