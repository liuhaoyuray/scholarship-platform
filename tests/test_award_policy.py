import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from award_policy import classify
class EvidencePolicy(unittest.TestCase):
 def row(self,**kw):return {'award':'国家奖学金','stage':'获奖/发放记录','locator':'Sheet1 · 第3行','level':'一等奖',**kw}
 def test_top_half_is_not_receipt(self):
  for p in ['国家奖学金前50%学生名单.xlsx','奖学金参评学生名单.xlsx','国奖名额测算/国家奖学金学生名单.xlsx']:
   self.assertEqual(classify(self.row(),{'path':p}),2)
 def test_generic_upload_and_application_are_not_receipt(self):
  self.assertEqual(classify(self.row(),{'path':'国家奖学金-导入系统.xlsx'}),6)
  self.assertEqual(classify(self.row(),{'path':'国家奖学金申请审批表.docx'}),3)
 def test_explicit_roster_and_payout_are_evidence(self):
  for p in ['2024年国家奖学金获奖名单.xlsx','国家奖学金发放明细.xlsx']:
   self.assertEqual(classify(self.row(),{'path':p}),1)
 def test_proposal_publicity_and_other_prize_are_not_receipt(self):
  self.assertEqual(classify(self.row(),{'path':'国家奖学金拟获奖名单.xlsx'}),3)
  self.assertEqual(classify(self.row(),{'path':'国家奖学金获奖名单公示.xlsx'}),4)
  self.assertEqual(classify(self.row(),{'path':'国家奖学金/三星奖学金获奖名单.xlsx'}),7)
 def test_summary_requires_specific_award_in_sheet_or_row(self):
  self.assertEqual(classify(self.row(locator='国家奖学金 · 第3行'),{'path':'2024奖学金汇总表.xlsx'}),1)
  self.assertEqual(classify(self.row(excerpt='虚构姓名 | 学号 | 1000'),{'path':'2024奖学金汇总表.xlsx'}),7)
 def test_withdrawn_record_never_counts(self):
  self.assertEqual(classify(self.row(stage='未获奖/放弃'),{'path':'国家奖学金获奖名单.xlsx'}),5)
 def test_directory_name_does_not_assign_its_prize_to_another_honor(self):
  self.assertEqual(classify(self.row(award='比亚迪奖学金',locator='优秀研究生 · 第3行'),{'path':'比亚迪奖学金/2025-2026学年各类资助明细汇总表.xlsx'}),7)
 def test_final_filename_cannot_override_application_decisions(self):
  source={'path':'志愿公益奖学金汇总表(最终).xlsx','sheet_headers':{'Sheet1':['姓名 | 学号 | 奖学金名称 | 申请理由 | 申请是否通过']}}
  self.assertEqual(classify(self.row(award='志愿公益奖学金',excerpt='虚构姓名 | 12345678 | 志愿公益奖学金 | 通过'),source),3)
  self.assertEqual(classify(self.row(award='志愿公益奖学金',excerpt='虚构姓名 | 不通过'),source),5)
 def test_example_and_recommendation_columns_are_not_final(self):
  self.assertEqual(classify(self.row(excerpt='例 | 虚构学院 | 12345678 | 张三 | 国家奖学金'),{'path':'国家奖学金汇总表.xlsx'}),3)
  self.assertEqual(classify(self.row(),{'path':'2025奖学金汇总表.xlsx','sheet_headers':{'Sheet1':['学号 | 姓名 | 推荐获奖等级 | 获奖金额']}}),3)
 def test_nomination_is_not_the_medal(self):
  self.assertEqual(classify(self.row(award='沈元奖章',excerpt='虚构姓名 | 沈元奖章提名奖'),{'path':'沈元奖章、提名奖获奖名单.xlsx'}),7)
 def test_other_university_is_reference(self):
  source={'path':'国家奖学金获奖名单.xlsx','sheet_headers':{'Sheet1':['序号 | 姓名 | 学校 | 学号']}}
  self.assertEqual(classify(self.row(excerpt='1 | 虚构姓名 | 虚构其他大学 | 12345678'),source),8)
if __name__=='__main__':unittest.main()
