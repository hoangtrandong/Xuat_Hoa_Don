import os
import sys
from datetime import datetime, timezone

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)
sys.stdout.reconfigure(encoding="utf-8")

from app.core.database import engine
from sqlalchemy import text

RAW_DATA = """001	Hà Ân	Nguyễn thị Hà	1	Hà Ân
002	Hoa Quang	Hoa Quang	2	Hoa Quang
003	Kỳ Phương	Kỳ Phương	3	Kỳ Phương
004	CAFE BỜ HỒ	Phạm Thị Dung	4	CAFE BỜ HỒ
005	c hoa thọ	nguyn thi hoa	5	c hoa thọ
006	Hồng Sen	Hồng Sen	6	Hồng Sen
007	Vân Năm	Vân Năm	7	Vân Năm
008	Chị Lan	Nguyễn Thị Lan	8	Chị Lan
009	Chị Hải	Chị Hải	9	Chị Hải
00A	Nhung Lý	Nguyễn Thị Nhung	10	Nhung Lý
00B	Phương Vi		11	Phương Vi
00C	bánh mỳ tiến đat	chitám	12	bánh mỳ tiến đat
00D	Hoa Hà	Hoa Hà	13	Hoa Hà
00E	th thảo linh	Nguyễnthi năm	14	th thảo linh
00F	Thành Vinh	Thành Vinh	15	Thành Vinh
00G	Nam Loan	Hoàng Thị Loan	16	Nam Loan
00H	Chị Phương	Chi Phương	17	Chị Phương
00I	Hùng Hải	Thái Thị Hải	18	Hùng Hải
00J	Châu Hà		19	Châu Hà
00K	Vinh Tuyết	Vinh Tuyết	20	Vinh Tuyết
00L	Dì Tám Huệ	chi tám	21	Dì Tám Huệ
00M	Cường Hiền	Gì Mai	22	Cường Hiền
00N	ca fe anh duy	ca fe anh duy	23	ca fe anh duy
00O	Tuấn Hữu	Tuấn Hữu	24	Tuấn Hữu
00P	ca fe huy hoa	Nguyễn Xuân Thủy	25	ca fe huy hoa
00Q	chi quý	tăng thị quý	26	chi quý
00R	chi hằng anh	Tràn Thị Hằng	27	chi hằng anh
00S	Táo Mart	Nguyễn thị thùy dung	28	Táo Mart
00T	c huong	nguyenthi huong	29	c huong
00U	Cường Trang	nguyen thi trang	30	Cường Trang
00V	c lien hông	nguyễn canh lý	31	c lien hông
00W	Nam Hoàn	anh nam	32	Nam Hoàn
00X	Hà Hải	Hà Hải	33	Hà Hải
00Y	Phương Hương	THAI THI HUONG	34	Phương Hương
00Z	Chị Hoa Toan	Chị Hoa	35	Chị Hoa Toan
010	Nghĩa Thành	Nghĩa Thành	36	Nghĩa Thành
011	Loan Hải	Loan hải	37	Loan Hải
012	Thu Quảng	Thu Quảng	38	Thu Quảng
013	Đài Tú	NGUYEN VAN DAI	39	Đài Tú
014	Thành Đô	Thành Đô	40	Thành Đô
015	cục quân khu 4	lê hữu trọng	41	cục quân khu 4
016	Sơn Hằng	Sơn Hằng	42	Sơn Hằng
017	phươnghồng 2	Thái Thị Phương Anh	43	Phương Hồng
018	lý ngà	Nguyễn Thị Ngà	44	lý ngà
019	Thái An	Nguyễn Công An	45	Thái An
01A	Gì Nhâm	Nguyễn Thị Nhâm	46	Gì Nhâm
01B	hoa khanh	hoa khanh	47	hoa khanh
01C	Hiếu Nhi	Nguyễn Thị Hợp	48	Hiếu Nhi
01D	Tám Thanh	Tám Thanh	49	Tám Thanh
01E	Thuỷ Hùng		76	Thủy Hùng
01F	Sơn La Mini mart	a hùng	51	Sơn La Mini mart
01G	Moon Qúan	Nguyễn Thị Hà	52	Moon Qúan
01H	lam quang	đặng thi lam	53	lam quang
01I	chi vinh tt	chi vinh	54	chi vinh tt
01J	Đức Hải	Đức Hải	55	Đức Hải
01K	Thảo Hùng	Thảo hùng	56	Thảo Hùng
01L	Tuấn  Thành	Nguyễn Anh Tuấn	57	Tuấn  Thành
01M	Cafe Cường Anh	Nguyễn Doãn Thái Cường	58	Cafe Cường Anh
01N	Liên Thu	Liên Thu	59	Liên Thu
01O	Cafe wild west	anh thống	60	Cafe wild west
01P	Giang Dũng	Giang Dũng	61	Giang Dũng
01Q	Sinh Thuỷ	Sinh Thuỷ	62	Sinh Thuỷ
01R	Vinh Hải	Vinh Hải	63	Vinh Hải
01S	Bảo Duy	Quang Anh	64	Bảo Duy
01T	Trung Liên	Trung Liên	65	Trung Liên
01U	Siêu Thị Binh Binh	hoang văn nhật	66	Siêu Thị Binh Binh
01V	chi phương anh	thai thi phương anh	67	chi phương anh
01W	Lam Nga	Nguyễn Văn Lam	68	Lam Nga
01X	Hoan Kiên	phạm thi hoan	69	Hoan Kiên
01Y	Hoà Xuân	Hoà Xuân	70	Hoà Xuân
01Z	Giap Hà	Đặng Thị Hà	71	Giap Hà
020	Hoàn Thi	Hoàng Đình Thi	72	Hoàn Thi
021	ngọc anh	nguyên thi công	73	ngọc anh
022	Hoài Thủy	Phạm Thị Thủy	74	Hoài Thủy
023	việt anh		75	việt anh
024	chi thủy	đinh thi huyền	76	Thủy Hùng
025	Hoàn Huyền	Nguyễn Văn Hoàn	77	Hoàn Huyền
026	chi huong	huonb	78	chi huong
027	Thảo Nguyên	Thảo Nguyên	79	Thảo Nguyên
028	Nguyễn Sỹ Ba	NGUYEN SY BA	80	Nguyễn Sỹ Ba
029	Phương Hồng		43	Phương Hồng
02A	Thanh Minh	Thanh Minh	82	Thanh Minh
02C	Yến Bốn	Yến Bốn	83	Yến Bốn
02D	Loan Phượng	chị phượng	84	Loan Phượng
02E	chi vân  thọ	Ngô Thị Vân	85	chi vân  thọ
02F	Bảy Sơn		86	Bảy Sơn
02G	Huệ Hồng		87	Huệ Hồng
02H	ca fe santo	vo thi hồng vân	88	ca fe santo
02I	Lan Lộc	Lan Lộc	89	Lan Lộc
02J	Hải Dũng	Thái Thị Hải	90	Hải Dũng
02K	cà phê anh mạnh	Anh mạnh	91	cà phê anh mạnh
02L	Cafe 1.7	Chị Hoa	92	Cafe 1.7
02M	Hoàng Liệu	Hoàng Liệu	93	Hoàng Liệu
02N	Thái Hoa	nguyen thi thanh hoa	94	Thái Hoa
02O	Thủy Hà	Trần Thị Thủy	95	Thủy Hà
02P	Tuyết Hòa		96	Tuyết Hòa
02Q	minh quý	đặng thị quý	97	minh quý
02R	Nhâm Tư	Nhâm Tư	98	Nhâm Tư
02S	Thanh Giap	Nguyễn Thị Thanh	99	Thanh Giap
02T	bánhmi  tt	hoang minh anh	100	bánhmi  tt
02U	Ngọc Bảy	Ngọc Bảy	101	Ngọc Bảy
02V	Gì Vân Tâm	Gì Vân Tâm	102	Gì Vân Tâm
02W	st nhà sách đl	phạm thi khang	103	st nhà sách đl
02X	hoài thu	trân thi hoài  thu	104	hoài thu
02Y	sc binh minh	trần thi hẳng	105	sc binh minh
02Z	hoài linh 2	Tăng Anh Tuấn	106	Hoài Linh
030	chu lời	nguyễn kim lời	107	chu lời
031	Hùng Mai	Hùng Mai	108	Hùng Mai
032	Hùng Hoài	Hùng Hoài	109	Hùng Hoài
033	Xuân Hòa	Xuân Hòa	110	Xuân Hòa
034	Quỳnh Cường	Dương Thị Lê Quỳnh	111	Quỳnh Cường
035	Nhàn thắng	đào văn dũng	112	Nhàn thắng
036	Thanh Hà Mart	Thanh Hà Mart	113	Thanh Hà Mart
037	Hằng Toàn	Hằng Toàn	114	Hằng Toàn
038	Hằng Du	c hằng	115	Hằng Du
039	Ngọc Trang	Nguyễn Thị Trang	116	Ngọc Trang
03A	Hải Huyền mart	Nguyễn thanh Hải	117	Hải Huyền mart
03B	Thìn Thạch	Thìn Thạch	118	Thìn Thạch
03C	Vượng Lệ	Vượng Lệ	119	Vượng Lệ
03D	Xuân Vinh	Xuân Vinh	120	Xuân Vinh
03E	Hồng Năm	Phạm Thị Thương Thương	121	Hồng Năm
03G	Xanh Mart	anh Bảo	122	Xanh Mart
03H	Oanh Nam	PHAM THI KIM OANH	123	Oanh Nam
03J	Ngọc Hiền	Ngọc Hiền	124	Ngọc Hiền
03K	Liên Hải	Nguyễn Thị Bích Liên	125	Liên Hải
03L	Hà Bốn	Chị Hà	126	Hà Bốn
03M	Hào Lý	Hào Lý	127	Hào Lý
03N	Hoài Đồng	Nguyễn thị nguyệt	128	Hoài Đồng
03O	Hương Cân	NGUYEN THI HUONG	129	Hương Cân
03P	Tứ Lý	Chị Lý	130	Tứ Lý
03Q	Tiên Thắng	Tiên Thắng	131	Tiên Thắng
03R	Thuận Điệp	chị điệp	132	Thuận Điệp
03S	Thương Thụ	Thương Thụ	133	Thương Thụ
03T	Hường Hòa	Hường Hòa	134	Hường Hòa
03U	Phương Hùng		135	Phương Hùng
03V	Gì Sửu	Gì Sửu	136	Gì Sửu
03W	Hồng Hòa	lê thị hồng	137	Hồng Hòa
03X	Hoang Anh Cafe	hoang anh	138	Hoang Anh Cafe
03Y	Chị Hà	Chị Hà	139	Chị Hà
03Z	Hóa Diệu	Hóa Diệu	140	Hóa Diệu
040	Hòa Thảo	Hòa Thảo	141	Hòa Thảo
041	Tư Đức	Tư Đức	142	Tư Đức
042	Vinh Trang	Vinh trang	143	Vinh Trang
043	Cafe Tùng	nguyen danh tung	144	Cafe Tùng
044	Thanh Phương	Thanh Phương	145	Thanh Phương
045	Tâm La	trần gia tam	146	Tâm La
046	Cafe Mộc	Thái Bá Phương	147	Cafe Mộc
047	Hà Hùng	Hà Hùng	148	Hà Hùng
048	Ngân Lê	Lê Thị Ngân	149	Ngân Lê
049	Thu Trung	Nguyễn Quốc Trung	150	Thu Trung
04A	Lan Chiến	Nguyễn Thị Lan	151	Lan Chiến
04B	Hương Mật	Hương Mật	152	Hương Mật
04C	Mạnh Quân		153	Mạnh Quân
04E	Liên Thành	Chị liên	154	Liên Thành
04F	Lương Toàn		155	Lương Toàn
04G	Quang hợp	hoàng mạnh thủy	156	Quang hợp
04H	Phương Hùng	TRAN THI LAN PHUONG	157	Phương Hùng
04I	Bà Hồng	bà hồng	158	Bà Hồng
04J	Oanh Bình	Oanh Bình	159	Oanh Bình
04K	Tuấn Sen	Tuấn Sen	160	Tuấn Sen
04L	Tuấn Hà	Tuấn Hà	161	Tuấn Hà
04M	Trà Chanh Tiệm	A Tuấn	162	Trà Chanh Tiệm
04N	Nguyệt Lý	Nguyệt Lý	163	Nguyệt Lý
04O	Chín Vân		164	Chín Vân
04P	Chị Hồng bánh mướt	Chị Hồng bánh mướt	165	Chị Hồng bánh mướt
04Q	Phương Mạo	Phương Mạo	166	Phương Mạo
04R	Trường An	Nguyễn Thị An	167	Trường An
04S	Châu Kim	nguyễn đăng châu	168	Châu Kim
04U	Siêu Thị Linh Đan	Siêu Thị Linh Đan	169	Siêu Thị Linh Đan
04V	Diệu Sơn		170	Diệu Sơn
04W	Tuấn Nhã	DANG NGOC TUAN	171	Tuấn Nhã
04X	Thương Phú	HAN THI VUI	172	Thương Phú
04Y	Siêu thị Anh Thắng Mart	nguyễn văn hiếu	173	Siêu thị Anh Thắng Mart
04Z	Đức Long	Đức Long	174	Đức Long
050	Hiền Lý	Hiền Lý	175	Hiền Lý
051	Chị oanh huệ	trần minh huệ	176	Chị oanh huệ
052	Bằng Minh	NGUYEN THI MINH	177	Bằng Minh
053	Hà Bé	LE THI HA	178	Hà Bé
054	Nga Hồng	Cao Thị Nga	179	Nga Hồng
055	Huyền Nhạc	Huyền Nhạc	180	Huyền Nhạc
056	Siêu Thị Ngọc Hải	Chị Hải	181	Siêu Thị Ngọc Hải
057	Vinh Thắng	Vinh Thắng	182	Vinh Thắng
058	a thọ hoa	le đình thọ	183	a thọ hoa
059	Hương Việt	Hương Việt	184	Hương Việt
05A	Chị Hồng	Trần Thị Bích Hồng	185	Chị Hồng
05B	Hồng Lợi	Nguyễn Thị Thuý	186	Hồng Lợi
05C	Xuân Thành	NGUYEN VAN THANH	187	Xuân Thành
05D	Chị Nga	Lê Thị Nga	188	Chị Nga
05E	Trí Ngọt		189	Trí Ngọt
05F	Dì Tùng		190	Dì Tùng
05G	Chuyên Nga	Chuyên Nga	191	Chuyên Nga
05H	Thúy Tân	Nguyễn Văn Thí	192	Thúy Tân
05I	Trị Sen		193	Trị Sen
05J	Son ly	Son Ly	194	Son ly
05K	Bà Hợi		195	Bà Hợi
05L	Hà Thu	Tăng Thị Hà	196	Hà Thu
05M	Dì Thuận	Dì Thuận	197	Dì Thuận
05N	Ngân Trường	TRAN THI NGAN	198	Ngân Trường
05O	Bà Hồng	Nguyễn Thị Lan	199	Bà Hồng
05P	Bà Mùi	NGUYEN THI MUI	200	Bà Mùi
05Q	Nguyễn Thị Tình	Nguyễn Thị Tình	201	Nguyễn Thị Tình
05R	Ngoc Sen	Sen	202	Ngoc Sen
05S	Hồng Hiền	Hồng Hiền	203	Hồng Hiền
05T	KIM CAFE	Nguyễn Thị Thơm	204	KIM CAFE
05U	Dì Oanh	Hòa Thuận	205	Dì Oanh
05V	Lam Hải	Lam Hải	206	Lam Hải
05W	Vinh Chu	Nguyễn Thị Vinh	207	Vinh Chu
05X	Thành Phương	Thành Phương	208	Thành Phương
05Y	Minh Châu	Lê Thị Minh Châu	209	Minh Châu
05Z	Tuấn Toàn	Thái Thị Thúy	210	Tuấn Toàn
060	Thái Thị Đức	Đức Sỹ	211	Thái Thị Đức
061	Dì Lan	Dương Thị Hương	212	Dì Lan
062	kh HOA CHIẾN	nguyên thi ho	213	kh HOA CHIẾN
063	Gì Hương	Gì Hương	214	Gì Hương
064	hải thắng	nguyen thị hải	215	hải thắng
065	688 Quang Sơn	Phạm Văn Thắng	216	688 Quang Sơn
066	me be BABY STORE	Nguyễn Tất Tuấn Anh	217	me be BABY STORE
067	Nguyệt Anh	Nguyễn Thị Nguyệt	218	Nguyệt Anh
068	Chị Hòa	Chị Hòa	219	Chị Hòa
069	Vân Tý	Nguyễn Thị Vân	220	Vân Tý
06A	Kim Ngân	Dì Tùng	221	Kim Ngân
06B	Thơm Thanh	Trần Thị Thơm	222	Thơm Thanh
06C	Thu Đông	Thu Đông	223	Thu Đông
06D	Shop Hải An	em huong	224	Shop Hải An
06E	Bà Mùi	Chị Lĩnh	225	Bà Mùi
06F	Thương Hào	Hứa Thị Thương	226	Thương Hào
06G	Em Lam	vũ thi lam	227	ST Linh Hương
06H	Hà Tâm	đào thị bích hà	228	Hà Tâm
06I	Siêu Thị Mẹ Và Bé Thanh Bình	Phương Nam	229	Siêu Thị Mẹ Và Bé Thanh Bình
06J	chị nhâm	Lê Thị Nhâm	230	chị nhâm
06K	Thuận Thanh	Nguyễn Nguyên Thuận	231	Thuận Thanh
06L	Dung Danh	Hồ Thị Danh	232	Dung Danh
06M	Lương Đông	Trần Thị Lương	233	Lương Đông
06N	Hà Sáu	Hà Sáu	234	Hà Sáu
06O	Quầy Thuốc Dương Thị Sáu	dương thị sáu	235	Quầy Thuốc Dương Thị Sáu
06P	Chung Linh	Chung Linh	236	Chung Linh
06Q	kh ngoc hải	nguyen thanh hai	237	kh ngoc hải
06R	Hoa Cương	Hoa Cương	238	Hoa Cương
06S	Hương Bảy		239	Hương Bảy
06T	Thủy Tú	dì thái	240	Thủy Tú
06U	Hằng phú	em Hằng	241	Hằng phú
06W	CT may Minh Anh	Nguyễn Thư Lý	242	CT may Minh Anh
06X	Thí Lưu	nguyen thị thí	243	Thí Lưu
06Y	Anh Nga	Anh Nga	244	Anh Nga
06Z	Em Minh	Chị Phương	245	Em Minh
070	Châu Lương	Châu Lương	246	Châu Lương
071	Chị Liên	Chị Liên	247	Chị Liên
072	Cfe ngoc hải	nguyên thi hải	248	Cfe ngoc hải
073	Thúy Toàn	nguyễn thị toàn	249	Thúy Toàn
074	Nguyễn Thị Thủy	Nguyễn Thị Thủy	250	Nguyễn Thị Thủy
076	Quang Phương	Thái Thị Phương	251	Quang Phương
077	Nhâm Hợi	Nhâm Hợi	252	Nhâm Hợi
078	Hoa Dụ	Hoa Dụ	253	Hoa Dụ
079	Chung Hồng	thái thi hồng	254	Chung Hồng
07A	Hạnh Hào	trần thị hanh	255	Hạnh Hào
07B	Chị Thoa	nguyen thi thao	256	Chị Thoa
07C	Chị Ngọc Hải	Chị Ngọc	257	Chị Ngọc Hải
07D	Em Thảo		258	Em Thảo
07E	Nhàn Lĩnh	nguyen thi quang	259	Nhàn Lĩnh
07F	Bà Hành	Bà Hành	260	Bà Hành
07G	Diệu Anh	Phạm Văn Tuấn	261	Diệu Anh
07H	Hạnh Tuyết	Lê Thị Tuyết	262	Hạnh Tuyết
07I	Bình Trà	hoang đình trà	263	Bình Trà
07J	Trang Diễn		264	Trang Diễn
07K	Thắng Kim	Thái Thị Kim	265	Thắng Kim
07L	cốm baby	NGUYỄN THỊ HẢO	266	cốm baby
07M	Hải Anh	Lương Thị Thùy	267	Hải Anh
07N	Hiền Hùng	hong sy	268	Hiền Hùng
07O	hiền phương	hiền phương	269	hiền phương
07P	Linh Trang	Nguyễn Thị Huyền Trang	270	Linh Trang
07Q	KMart+	Trần Văn Cường	271	KMart+
07R	Hà Bé	Trần Thị Bé	272	Hà Bé
07S	Em Ly	NGUYỄN THỊ THẢO LY	273	Em Ly
07T	Lan Thuận	Nguyễn Thị Lan	274	Lan Thuận
07U	Hậu Lộc	hoang thị hằng	275	Hậu Lộc
07V	kh Linh linh	trân ngoc bao	276	kh Linh linh
07W	kh  MINH ĐẠT	lê thị thúy minh	277	kh  MINH ĐẠT
07X	Siêu Thị Hạnh Cường	Thái Thị Hồng Hạnh	278	Siêu Thị Hạnh Cường
07Y	Dương Luyện	Dương Luyện	279	Dương Luyện
07Z	Hồng Vân	Đặng Minh Hồng	280	Hồng Vân
080	chị vân anh	Nguyễn Thị Vân Anh	281	chị vân anh
081	Hà Châu	LÊ THỊ HÀ	282	Hà Châu
082	Siêu thị mẹ và bé Em trang	nguyễn thi trang	283	Siêu thị mẹ và bé Em trang
083	Ngọc Nương	nguyễn thị nương	284	Ngọc Nương
084	Hương Cường	Hương Cường	285	Hương Cường
085	Tuyết Túy	Nguyễn Thị Tuyết	286	Tuyết Túy
086	Hoan Tý		287	Hoan Tý
087	phương phú	Nguyễn công phú	288	phương phú
088	Minh Thuận	lê thị thuận	289	Minh Thuận
089	Trang Tuấn		290	Trang Tuấn
08A	Hường Văn	Lê Thị Hường	291	Hường Văn
08B	Hà Mạnh	thái ngai	292	Hà Mạnh
08C	Hùng Tâm	Hùng Tâm	293	Hùng Tâm
08D	Tình Huấn	Tình Huấn	294	Tình Huấn
08E	Mẹ và bé Em Hiền	Nguyễn Tất Thảo	295	Mẹ và bé Em Hiền
08F	Hiền Hòa	Hiền Hòa	296	Hiền Hòa
08G	Anh linh	Anh linh	270	Linh Trang
08H	Loan Thanh	chi loan thanh	298	Loan Thanh
08I	Hương Hùng		299	Hương Hùng
08J	Hợp Yến	TRAN NGOC HOP	300	Hợp Yến
08K	minh đông	Minh đông	301	minh đông
08L	Huyền Trân	lê thị tuất	302	Huyền Trân
08M	HƯƠNG ANH BABY	bui thanh hương	303	HƯƠNG ANH BABY
08N	Tuyết Bảo	Hồ Thị Hồng	304	Tuyết Bảo
08O	Phúc Thông	cường thu	305	Phúc Thông
08P	Chị Nhung Trường	Nguyễn Thị Nhung	306	Chị Nhung Trường
08Q	Dũng Huyền	Nguyễn Thị Huyền	307	Dũng Huyền
08R	ST Linh Hương	Phạm Ngọc Hội	227	ST Linh Hương
08S	kh  Phương Quyên	PHƯƠNG QUYÊN	309	kh  Phương Quyên
08T	Hằng Bính	Hoàng Thị Thúy Hằng	310	Hằng Bính
08U	Hiền Thịnh	thái thị hiên	311	Hiền Thịnh
08V	Tùng Hồng	LE THI TUNG	312	Tùng Hồng
08W	Thanh Toàn	Nguyễn Thị Thanh	313	Thanh Toàn
08X	ba thảo	đang thị thảo	314	ba thảo
08Y	Sữa 3 tốt	Trần Thị Hải Yến	315	Sữa 3 tốt
08Z	Mai An	Trần Thị Mai	316	Mai An
090	Chị Quý	Chị Quý	317	Chị Quý
091	Hương Điều	Đoàn Thanh Hương	318	Hương Điều
092	Bỉm Sữa Thanh Bình	Đặng Thị Nga	319	Bỉm Sữa Thanh Bình
093	Hòa Tùng	Hòa Tùng	320	Hòa Tùng
094	Châu Hà	Châu Hà	321	Châu Hà
095	Chị Ngọc Hà	Chị Ngọc Hà	322	Chị Ngọc Hà
096	Lan Hồng	Lan Hồng	323	Lan Hồng
097	Đại Phước	Đại Phước	324	Đại Phước
098	Bỉm sữa nội oanh	Nguyễn Thị Oanh	325	Bỉm sữa nội oanh
099	Nguyệt Thắng	Nguyệt Thắng	326	Nguyệt Thắng
09A	Tâm Sửu	Tâm Sửu	327	Tâm Sửu
09B	Cà phê Lion	Lê Thế Toàn	328	Cà phê Lion
09C	Huyền Anh	Huyền Anh	329	Huyền Anh
09D	Hòa Sự	Hòa Sự	330	Hòa Sự
09E	Lam Lệnh	Lờ Thị Lam	331	Lam Lệnh
09G	Chị Phương Linh	Chị Phương	332	Chị Phương Linh
09H	Hoa Ngọc	Chị Hoa	333	Hoa Ngọc
09I	Anh Quý	NGUYEN THI ANH	334	Anh Quý
09J	Lý Khánh	Lý Khánh	335	Lý Khánh
09K	Đồng viên mart	chị viên	336	Đồng viên mart
09L	Kiên Hường	Kiên Hường	337	Kiên Hường
09M	Hữu Hào	Nguyễn Thị Hào	338	Hữu Hào
09N	Bảo Long	chị yến	339	Bảo Long
09O	Thắng Hường	Lê Thị Hường	340	Thắng Hường
09P	Chị Phượng	Lê Đình Kháng	341	Chị Phượng
09Q	Hiền Tâm	chị tâm	342	Hiền Tâm
09R	Mai Hoàng	Mai Hoàng	343	Mai Hoàng
09S	Siêu Thị Minh Dung	Đặng Thị Dung	344	Siêu Thị Minh Dung
09T	Chị Thu Dũng	Chị Thu	345	Chị Thu Dũng
09U	Bà Niên	bà niên	346	Bà Niên
09V	Hùng Lưu 2	Nguyễn Thị Lưu	347	Hùng Lưu 2
09W	Nhi Đông	Nguyễn Văn Đồng	348	Nhi Đông
09X	Gì Hòa	Gì Hòa	349	Gì Hòa
09Y	Chị Thủy	chi thuy	350	
09Z	Thành Chung	Thành Chung	351	Thành Chung
0A0	Hùng Lưu	Nguyễn Thi Lưu	352	Hùng Lưu
0A1	Tuấn Hằng	chị hằng	353	Tuấn Hằng
0A2	ưng toàn	TRẦN HỒNG XOAN	354	ưng toàn
0A3	Bỉm sữa 886	phạm văn tuyết	355	Bỉm sữa 886
0A4	Lan Hong	Di lan	356	Lan Hong
0A5	Chị Hoài	Chị Hoài	357	Chị Hoài
0A6	cafe IQ	cafe IQ	358	cafe IQ
0A7	Cảnh Vóc	Cảnh Vóc	359	Cảnh Vóc
0A8	Văn Thoả	Văn Thoả	360	Văn Thoả
0A9	Bảy Lý	Trần Thị Bảy	361	Bảy Lý
0AA	Dung Tuấn	TRAN THI DUNG	362	Dung Tuấn
0AB	Hoa Lượng	NGUYEN DUC LUONG	363	Hoa Lượng
0AC	Thuý Hoan	Nguyễn Thị Thúy	364	Thuý Hoan
0AD	Cafe mẹ gông	Nguyễn Thị Oanh	365	Cafe mẹ gông
0AE	Thủy Hùng	nguyễn thị thúy	366	
0AF	Thành Hồng	Chị Hồng	367	Thành Hồng
0AG	Chuyên Khánh	NGUYEN THI CHUYEN	368	Chuyên Khánh
0AH	Ninh Nga		369	Ninh Nga
0AI	Tuấn Thế	Nguyễn Thị Thế	370	Tuấn Thế
0AJ	Toàn Thắng	Chị Trang	371	Toàn Thắng
0AK	Hoài Linh		106	Hoài Linh
0AL	Ngọc Sơn	Ngọc Sơn	373	Ngọc Sơn
0AM	Chị Lan Hùng	Nguyến Thị Lan	374	Chị Lan Hùng
0AN	Hoàng sơn	NGUYỄN THỊ THÚY	375	Hoàng sơn
0AO	chi mai hồng	Nguyễn thi mai	376	chi mai hồng
0AP	chinh bình	e bình	377	chinh bình
0AQ	Chị Hoa Dũng	Hoàng Thị Hoa	378	Chị Hoa Dũng
0AR	Phước Oanh	Trần thị Oanh	379	Phước Oanh
0AS	Pham Thi Phuong	Phuong Long	380	Pham Thi Phuong
0AT	Hương Định	Hương Định	381	Hương Định
0AU	Hoài chương	đặng thị hoài	382	Hoài chương
0AV	Nhà Thuốc Thiện Nhân	Lê Thị Tú	383	Nhà Thuốc Thiện Nhân
0AW	Hồng Dương	PHAM DINH DUONG	384	Hồng Dương
0AX	Thắm Hạnh	Nguyễn Thị Thắm	385	Thắm Hạnh
0AY	Linh Hòa	Trần Khắc Hòa	386	Linh Hòa
0AZ	Lý Hùng	PHAN THị Lý	387	Lý Hùng
0B0	Thành Nga	Nguyễn Đình Thành	388	Thành Nga
0B1	Hồng Trung	Phạm Thị Hồng	389	Hồng Trung
0B2	Phương Hồng	Phương Hkkngf	390	Phương Hồng
0B3	Thảo augt	lê thị thảo	391	Thảo augt
0B4	Sửu Thắng	Sửu Thắng	392	Sửu Thắng
0B5	Chị Mai	Phan Thị Mai	393	Chị Mai
0B6	Phương Giang	Phương Giang	394	Phương Giang
0B7	Håi năng	Võ Thị Năng	395	Håi năng
0B8	Tâm Huy	Lưu Thị Lam	396	Tâm Huy
0B9	Quý Luyến	tRầN THị LUYếN	397	Quý Luyến
0BA	Quỳnh Danh	Thái Ngô Danh	398	Quỳnh Danh
0BB	Ngọc Hành	Ngọc Hành	399	Ngọc Hành
0BC	Yến Dũng	Chị Yến	400	Yến Dũng
0BE	Tùng Oanh	chị oanh	401	Tùng Oanh
0BF	cà phê H2	chị hường	402	cà phê H2
0BG	Hổ quán	e hương	403	Hổ quán
0BH	Chị Hoa	Hoa	404	Chị Hoa
0BI	hanh hoe	hanh hoe	405	hanh hoe
0BJ	Chính Thuận	Chính Thuận	406	Chính Thuận
0BK	Ngọc Phương	Dương Xuân Ngọc	407	Ngọc Phương
0BL	Sỹ Mận	chị mận	408	Sỹ Mận
0BM	Thu Lưu	Thu Đông	409	Thu Lưu
0BN	Thảo Hoa	Thảo Hoa	410	Thảo Hoa
0BO	Trường Nho	NGUYễN THị TRƯờNG	411	Trường Nho
0BP	Xuân Đức	Xuân Đức	412	Xuân Đức
0BQ	Thanh á	PHAM THI THANH	413	Thanh á
0BR	Huyền Chiến	Huyền Chiến	414	Huyền Chiến
0BS	Đãi Liễu	Trần Thị Bích Liễu	415	Đãi Liễu
0BT	Thúy hoài	Nguyễn Thị Hoài	416	Thúy hoài
0BU	Đức Mai	Đức Mai	417	Đức Mai
0BV	Bà hợi	bà hợi	418	Bà hợi
0BW	Hữu Thoa	Nguyễn Thị Oanh	419	Hữu Thoa
0BX	Lâm việt	Ngân Thị Lâm	420	Lâm việt
0BY	Thành Vân	Thành Vân	421	Thành Vân
0BZ	Thanh Ngân	Mai Thị Hường	422	Thanh Ngân
0C0	thúy Huế	Nguyễn Thị Thúy	423	thúy Huế
0C1	Ngọc Cảnh	Ngọc Cảnh	424	Ngọc Cảnh
0C2	gì tình lương	hoàng thi lương	425	gì tình lương
0C3	Hằng Sơn	bà hằng sơn	426	Hằng Sơn
0C4	Phương Anh	Nguyễn Thị Phương Anh	427	Phương Anh
0C5	Đoài Oanh	Đoài Oanh	428	Đoài Oanh
0C6	Tính Hoài	Chị hoài	429	Tính Hoài
0C7	Cà phê Núi	Nguyễn Quang Nguyên	430	Cà phê Núi
0C8	Thảo Đinh	Chị Oanh	431	Thảo Đinh
0C9	Bình Trọng	Bình Trọng	432	Bình Trọng
0CA	Linh Hưng		433	Linh Hưng
0CB	Bé Lân	Trần Thị Bé	434	Bé Lân
0CC	Lan Hiền	Tạ Danh Lan	435	Lan Hiền
0CD	Thanh Sơn Tky	Cao Thị Thanh	436	Thanh Sơn Tky
0CE	Thái Huy	Lê Văn Hảo	437	Thái Huy
0CF	Lương Tâm	Lương Tâm	438	Lương Tâm
0CG	Thiện Miên	chị thiện	439	Thiện Miên
0CH	Tường Hùng	Tường Hùng	440	Tường Hùng
0CI	Tấn Tự	Nguyễn Thị Tự	441	Tấn Tự
0CJ	Vinh Hạnh	Vinh Hạnh	442	Vinh Hạnh
0CK	Thu Sự	Nguyễn Thị Thu	443	Thu Sự
0CL	Qúy Minh	Nguyễn Ngọc Minh	444	Qúy Minh
0CM	kh gi long việt	Nguyễn Công Việt	445	kh gi long việt
0CN	Bác Kỷ	Nguyễn Thị Minh Thu	446	Bác Kỷ
0CO	Chị Quý	Tô Thị Quý	447	Chị Quý
0CP	Khang Phương	Tạ Hữu Khang	448	Khang Phương
0CQ	Nga Khoa	Hồ Thị Nga	449	Nga Khoa
0CR	Chị Hằng	CAO THI HANG	450	Chị Hằng
0CS	Loan Thế	Trần Thúy Loan	451	Loan Thế
0CT	Anh Liên	Phạm Hữu ánh	452	Anh Liên
0CU	Tài Khuyên	Nguyễn Thị Minh Thái	453	Tài Khuyên
0CV	Khánh Hà	Phan Thị Hà	454	Khánh Hà
0CW	Hiền Hoàng	chị hiền	455	Hiền Hoàng
0CX	dì nhượng	dì nhượng	456	dì nhượng
0CY	Bác Dung	Lê Thị Sen	457	Bác Dung
0CZ	Thảo Vy	Nguyễn Thị Thu Hương	458	Thảo Vy
0D0	Truyền Linh	Thái Thị Mỹ Linh	459	Truyền Linh
0D1	Quy Hùng	NGUYEN THI QUY	460	Quy Hùng
0D2	Tứ Mùi	Tứ Mùi	461	Tứ Mùi
0D3	Đào Đại		462	Đào Đại
0D4	688 Nghĩa Hoàn	Cao Thị Vân Anh	463	688 Nghĩa Hoàn
0D5	Hùng Sen	Hùng Sen	464	Hùng Sen
0D6	Khánh Cường	Nguyễn Thị hiền	465	Khánh Cường
0D7	Cúc Duy	Cúc Duy	466	Cúc Duy
0D8	Hoài Mạnh	Nguyễn Thị Lương	467	Hoài Mạnh
0D9	Hùng Thủy	Hùng Thủy	468	Hùng Thủy
0DA	KH Thắng nhuộm	thắng nhuộm	469	KH Thắng nhuộm
0DB	Đồng Dung		470	Đồng Dung
0DC	Bánh SN Bình Thùy	Đặng Thị Nga	471	Bánh SN Bình Thùy
0DD	Hùng Phương	c phương	472	Hùng Phương
0DE	Thủy Hạnh	Trần Thị Thủy	473	Thủy Hạnh
0DF	Thành Ngọ	Lê Thị Thành	474	Thành Ngọ
0DG	Tuấn Thủy	Hà Văn Ngọc	475	Tuấn Thủy
0DH	Lương Sâm	Lương Sâm	476	Lương Sâm
0DI	Thuận An	Hoàng Thị Thuận	477	Thuận An
0DJ	Chị Hằng	Đinh Lệ Hằng	478	Chị Hằng
0DK	Thanh Loan	Thanh Loan	479	Thanh Loan
0DL	lương trọng	lương	480	lương trọng
0DM	Hường Hải	Nguyễn Thị Hường	481	Hường Hải
0DN	Phương Lâm	nguyên văn lâm	482	Phương Lâm
0DO	Tâm An	Hoàng Thị Thanh Tâm	483	Tâm An
0DP	Hương Thông	Hương Thông	484	Hương Thông
0DQ	Chung Lưu	Nguyễn Thị Lưu	485	Chung Lưu
0DR	Thủy Tuyến	Đậu Thị Thủy	486	Thủy Tuyến
0DS	An Oanh	Chị oanh	487	An Oanh
0DT	Hoài Anh	Anh Anh	488	Hoài Anh
0DU	Bảo Như	Võ Văn Nghiên	489	Bảo Như
0DV	Đức hằng	Chị hằng	490	Đức hằng
0DW	Em Nhàn	Em nhàn	491	Em Nhàn
0DX	Đồng Đào	Lương thị hồng	492	Đồng Đào
0DY	Vinh Long	Nguyễn Thị Vinh	493	Vinh Long
0DZ	Tạp Hóa Hải Hòa	Phạm Thị Kim Hòa	494	Tạp Hóa Hải Hòa
0E0	Thúy Đồng	Trần Thị Thúy	495	Thúy Đồng
0E1	Hằng Hào	Trần Thị Hằng	496	Hằng Hào
0E2	Bà Vân	Bà Vân	497	Bà Vân
0E3	Hoa Quang	Hoàng Đình Ngọc	498	Hoa Quang
0E4	Đức Lựu	Nguyễn Thị Lựu	499	Đức Lựu
0E5	Lý Biên	nguyen thi ly	500	Lý Biên
0E6	Cafe Hải	phan anh Tài	501	Cafe Hải
0E7	Đào Hải	Dì Đào	502	Đào Hải
0E8	Giang Quý	Nguyễn Thị Giang	503	Giang Quý
0E9	ba đào	NGUYỄN THỊ ĐÀO	504	ba đào
0EA	Sơn Ngoan	gì ngoan	505	Sơn Ngoan
0EB	Lợi Sơn	Lợi Sơn	506	Lợi Sơn
0EC	Chị Hải	Phạm Thị Hải	507	Chị Hải
0ED	Quý Hằng	võ Thị Hằng	508	Quý Hằng
0EE	Tuyết Triều	phạm văn triều	509	Tuyết Triều
0EF	Hòa Duyên	Lê Thị Duyên	510	Hòa Duyên
0EG	Trà Mi	Tô Thị Thanh	511	Trà Mi
0EH	Hải yến	Nguyễn Thị Yến	512	Hải yến
0EI	lâm phương	nguyen van lam	482	Phương Lâm
0EJ	Hiền Sơn	Thái Thị Hiền	514	Hiền Sơn
0EK	Chín Vân	Chín Vân	515	Chín Vân
0EL	sỹ hoa	Thái Thị Hoa	516	sỹ hoa
0EM	Thành Sơn		517	Thành Sơn
0EN	cường vân	nguyen thi vân	518	cường vân
0EO	Giáp Ngân	Nguyễn Thị Ngân	519	Giáp Ngân
0EP	Hoa lâm	trần văn lâm	520	Hoa lâm
0EQ	Oanh Hùng	Nguyễn Thị Oanh	521	Oanh Hùng
0ER	Hiền Huyền	Lê Thị Huyền	522	Hiền Huyền
0ES	Vân Thành	Vân Thành	523	Vân Thành
0ET	Bà Hà	Trương Thị Hà	524	Bà Hà
0EU	Huệ Đức	Mai Thị Huệ	525	Huệ Đức
0EV	phượng thức	phượng thức	526	phượng thức
0EW	thơm vinh	thơm vinh	527	thơm vinh
0EX	Hải mạnh	Hải mạnh	528	Hải mạnh
0EY	hà thu	hà thị thu	529	hà thu
0EZ	bim sữa thưởng loan	nguyễn thị loan	530	bim sữa thưởng loan
0F0	học hoan	trần quang học	531	học hoan
0F1	Bà liên thọ sơn	nguyễn thị liên	532	Bà liên thọ sơn
0F2	Hoa sơn	đậu thị hoa	533	Hoa sơn
0F3	Hoạch Hằng	Hà Văn Hoạch	534	Hoạch Hằng
0F4	Trung Nguyệt	Võ Thị Nguyệt	535	Trung Nguyệt
0F5	Thu Hùng	Lê Thị Thu	536	Thu Hùng
0F6	Em Linh Bán Chè	Chị Hà	537	Em Linh Bán Chè
0F7	Thảo Tú	Hùng Thanh	538	Thảo Tú
0F8	Hoài Thành	Hoài Thành	539	Hoài Thành
0F9	Cafe Lối Nhỏ	Thành Giang	540	Cafe Lối Nhỏ
0FA	Tuyết Quang	Dì Tuyết	541	Tuyết Quang
0FB	Tuyết Trì		542	Tuyết Trì
0FC	Dung Mạnh	Trần Thị Lam	543	Dung Mạnh
0FD	Chị Hà	Trần Thị Hà	544	Chị Hà
0FE	CF Bảy tuất	Nguyễn Đình Bảy	545	CF Bảy tuất
0FF	Hương Vịnh	Hương Vịnh	546	Hương Vịnh
0FH	Thai Hương	Đậu Thị Hường	547	Thai Hương
0FI	QUÁN 156	em hà	548	QUÁN 156
0FJ	Sơn Chí	Sơn Chí	549	Sơn Chí
0FK	ST KHO BỈM ANH SƠN	Nguyễn Văn Trường	550	ST KHO BỈM ANH SƠN
0FL	Khoa Trình	lương thị hiệp	551	Khoa Trình
0FM	Nhâm Kiều	Nhâm Kiều	552	Nhâm Kiều
0FN	Pháo Cà Phê	Lê Thị Thủy Tiên	553	Pháo Cà Phê
0FO	Hồng Hà	Nguyễn thị Hường	554	Hồng Hà
0FP	Thương Vinh	ĐặngThi Ngọc Thương	555	Thương Vinh
0FQ	Gì Loan	Đậu Thị Mai	556	Gì Loan
0FR	Bỉm sữa Linh Dân	Bùi Thị Linh	557	Bỉm sữa Linh Dân
0FS	Tân Sơn	Nguyễn Thị Tân	558	Tân Sơn
0FT	Ngọc Hùng	Trịnh Thị Ngọc	559	Ngọc Hùng
0FU	Hải Nhuần	Đinh Thị Nhuần	560	Hải Nhuần
0FV	Quang Tịnh	Quang Tịnh	561	Quang Tịnh
0FW	Nam Hiền	TRINH QUOC NAM	562	Nam Hiền
0FX	Huyền Tuệ	nguyễn thị thanh huyền	563	Huyền Tuệ
0FY	Bánh mì Bảo Ngọc	Nguyễn Thị Trang	564	Bánh mì Bảo Ngọc
0FZ	Cafe Mê Giông	Nguyễn Thị Vui	565	Cafe Mê Giông
0G0	Nguyễn Nho	Nguyễn Hồng Nho	566	Nguyễn Nho
0G1	tiệm nhà vũ	vũ xuân điệp	567	tiệm nhà vũ
0G2	Minh Tiêu 2	Minh Tiêu	568	Minh Tiêu 2
0G3	Tân Phương	Tân Phương	569	Tân Phương
0G4	Song Tinh	Nguyễn Trung Tình	570	Song Tinh
0G5	Chị Xuân	trần thị thanh xuân	571	Thành Xuân
0G6	Hoa Hồng	Trần Thị Hoa	572	Hoa Hồng
0G7	Lý Vượng	Nguyễn Thị Minh Lý	573	Lý Vượng
0G8	Quang Thắm	Phạm Thị Thanh	574	Quang Thắm
0G9	Đồng Dung	Hồ Văn Đồng	575	Đồng Dung
0GA	Nguyen Thi Huong	Huong Huong	576	Nguyen Thi Huong
0GB	Hương Hà	Lê Thị Thu Hương	577	Hương Hà
0GC	Ngọc Quân	Hà Thị Thuần	578	Ngọc Quân
0GD	Sơn Oanh	Trần Đức Sơn	579	Sơn Oanh
0GE	Siêu Thị Thùy Trà	Phạm Thị Nhung	580	Siêu Thị Thùy Trà
0GF	Nguyễn Thị Chinh	Nguyễn Thị Chinh	581	Nguyễn Thị Chinh
0GG	Hoàng Anh Mart	Thái Thị Nga	582	Hoàng Anh Mart
0GH	Hệ Thống Siêu Thị Mẹ và Bé - CHANG HOUSE		583	Hệ Thống Siêu Thị Mẹ và Bé - CHANG HOUSE
0GI	Em Nhàn Bệnh Viện		584	Em Nhàn Bệnh Viện
0GJ	Lý Thành	Lý Thành	585	Lý Thành
0GK	Kiên Phương	Đặng Văn Kiên	586	Chiên Thanh
0GL	Hùng Hương	Võ Trọng Hùng	587	Hùng Hương
0GM	Hải Mai	Hải Mai	588	Hải Mai
0GN	Bà Thành	Bà Thành	589	Bà Thành
0GO	Thịnh Huyền	Thịnh Huyền	590	Thịnh Huyền
0GP	Huệ Tài	Huệ Tài	591	Huệ Tài
0GQ	Siêu thị Kim Nhan	Nguyễn Thị Anh Thư	592	Siêu thị Kim Nhan
0GR	Mẹ & Bé Minh Dung Phan	Phan Thị Dung	593	Mẹ & Bé Minh Dung Phan
0GS	Chị Ly	Chị Ly	594	Chị Ly
0GT	Phượng Hải	phạm thị hải	595	Phượng Hải
0GU	Hưng Thắng	Nguyễn Thị Hưng	596	Hưng Thắng
0GV	Chiên Thanh	DUONG VAN THANH	586	Chiên Thanh
0GW	kim nhan coffee	đặng đình hoàng	598	kim nhan coffee
0GX	Chung Linh	Chung Linh	599	Chung Linh
0GY	Trúc Toàn	Phan Thị Châu	600	Trúc Toàn
0GZ	Chị  Sương	Chị sương	601	Chị  Sương
0H0	Anh Nam	Trần Hữu Nam	602	Anh Nam
0H1	bỉm sữa sỹ quỳnh	võ văn sỹ	603	bỉm sữa sỹ quỳnh
0H2	Vân Khánh 68	Chị Vân	604	Vân Khánh 68
0H3	Cường thuận	Cường Thuận	605	Cường thuận
0H4	kio quán	nguyễn thị ngọc	606	kio quán
0H5	Kim Quỳnh	Quỳ Triển	607	Kim Quỳnh
0H6	Huệ Lâm		608	Huệ Lâm
0H7	Thuận Nguyệt	Trần Thị Nguyệt	609	Thuận Nguyệt
0H8	Cẩm Được		610	Cẩm Được
0H9	Mỹ Hào cs2	Nguyễn Thị Mỹ	611	Mỹ Hào cs2
0HA	Toàn Thơm	Nguyễn Thị Thơm	612	Toàn Thơm
0HB	Siêu thị mini Thức Hường	nguyễn quốc thức	613	Siêu thị mini Thức Hường
0HC	Thủy Bảy	Thủy Bảy	614	Thủy Bảy
0HD	Dì Lan Hà	Nguyễn thị Lan	615	Dì Lan Hà
0HE	Tạp hóa Hường Bắc	Trần Thị Hường	616	Tạp hóa Hường Bắc
0HF	Khoa Thạch	Nguyễn Thị Khoa	617	Khoa Thạch
0HG	Sữa Bỉm Trung Nga	Dương Thị Nga	618	Sữa Bỉm Trung Nga
0HH	Chị Hoa Cát	Nguyễn Thị Hoa	619	Chị Hoa Cát
0HI	Hương Việt	Nguyễn Thị Thu Hương	620	Hương Việt
0HJ	bỉm sữa cường huyền	lê thị huyền	621	bỉm sữa cường huyền
0HK	Bà Tường	PHAN THI TUONG	622	Bà Tường
0HL	Thanh  Dần	Thanh Dần	623	Thanh  Dần
0HM	Lương Linh	Nguyễn Thị Tuyến Lương	624	Lương Linh
0HN	siêu thị mini đạt phúc	phạm trọng đức	625	siêu thị mini đạt phúc
0HO	nguyệt hùng	Phan Thanh Hùng	626	nguyệt hùng
0HP	Bà Lượng	Mậu Lượng	627	Bà Lượng
0HQ	Thành Xuân	Bùi Tiến Thành	571	Thành Xuân
0HR	Xin Tư	Lê Thị Tư	629	Xin Tư
0HS	My Thái	Thái Thị Nhung	630	My Thái
0HT	Liên Quảng	Liên Quảng	631	Liên Quảng
0HU	Chị Lý		632	Chị Lý
0HV	Mỹ Hào	Nguyễn Thị Mỹ	633	Mỹ Hào
0HW	Hương Thương	Anh Hương	634	Hương Thương
0HX	Mẹ và bé An Hùng	Em Hằng	635	Mẹ và bé An Hùng
0HY	Năm Anh Em	Vy Văn Bún	636	Năm Anh Em
0HZ	Tăng Sửu	Tăng Sửu	637	Tăng Sửu
0I0	Phương Bình Mart	Nguyễn Thị Phương	638	Phương Bình Mart
0I1	Trà Sữa Cua	Hoàng Trọng Quân	639	Trà Sữa Cua
0I2	Ngà Tú	Hồ Thị Ngà	640	Ngà Tú
0I3	Hoài Đại	Trần Thị Hoài	641	Hoài Đại
0I4	Ngọc Anh	Trần Thị Tú Ngọc	642	Ngọc Anh
0I5	Thái Nguyên	Lê Thị Thanh Tâm	643	Thái Nguyên
0I6	Hùng Ngọ	Hoàng Phi Hùng	644	Hùng Ngọ
0I7	Thanh Phúc	Nguyễn Đình Phúc	645	Thanh Phúc
0I8	Quang Thuỷ	Quang Thuỷ	646	Quang Thuỷ
0I9	Tâm Thao	Nguyễn Thị Tâm	647	Tâm Thao
0IA	Bánh Mì Đồng Tâm	Ánh Nguyệt	648	Bánh Mì Đồng Tâm
0IB	Bỉm sữa Thúy Trần	Trần Thị Thúy	649	Bỉm sữa Thúy Trần
0IC	Bình Xô	Chị Hồng	650	Bình Xô
0ID	Hữu ỏn	Hà tHị Thuần	651	Hữu ỏn
0IE	tráng  lý	nguyễn thị hải	652	tráng  lý
0IF	Tuấn Hạnh	Thái Thị Hạnh	653	Tuấn Hạnh
0IG	Thắng Hạnh	nguyễn thị lả	654	Thắng Hạnh
0IH	Trâm ba	Nguyễn Thị Thương	655	Trâm ba
0II	phương thảo	Võ Thị Phương Thảo	656	phương thảo
0IJ	Thành Lưu	NGUYEN THI LUU	657	Thành Lưu
0IK	Sơn Đông	TRAN THI LIEN	658	Sơn Đông
0IL	Nguyễn Thương	Chị Mai	659	Nguyễn Thương
0IM	Nhung Thanh	PHAN THI THANH	660	Nhung Thanh
0IN	Hà Hoàn	Lê Xuân Hà	661	Hà Hoàn
0IO	Miên Việt	Nguyễn Thị Bé	662	Miên Việt
0IP	Tecco quán	Nguyễn Thị Hạnh	663	Tecco quán
0IQ	Lý Thường		664	Lý Thường
0IR	Đồng Chi	Trần Thị Kim Chi	665	Đồng Chi
0IS	Bà Lìn	bà lìn	666	Bà Lìn
0IT	Sang Xuyên	Nguyễn Thị Cẩm Xuyên	667	Sang Xuyên
0IU	Ngọc Thúy	A Ngọc	668	Ngọc Thúy
0IV	Like Coffe	Nguyễn Thị Thơm	669	Like Coffe
0IW	Ngọc Hằng	Nguyễn Thị Hằng	670	Ngọc Hằng
0IX	Hưng Phượng	Chị Phượng	671	Hưng Phượng
0IY	chị Thư	nguyễn Thị Bảy	672	chị Thư
0IZ	Lam Thắng	Lam Thắng	673	Lam Thắng
0J0	Khiêm Hòa	Trần Văn Khiêm	674	Khiêm Hòa
0J1	Quân Trà	Nguyễn Thi Trà	675	Quân Trà
0J2	Tùng Nhung	Giản Thị Nhung	676	Tùng Nhung
0J3	May Tuyển	Vi Thị May	677	May Tuyển
0J4	Chị Thắng	Chị Thắng	678	Chị Thắng
0J5	Hồng Sơn	Bà Trân	679	Hồng Sơn
0J6	Huyến Láu	Phạm Thị Huyến	680	Huyến Láu
0J7	Vân Dũng	Vang Thị Vân	681	Vân Dũng
0J8	Nguyên Huyền (Hồng Hà 2)	Nguyễn Viết Nguyên	682	Nguyên Huyền (Hồng Hà 2)
0J9	Phúc Liễu	Hoàng Thị Liễu	683	Phúc Liễu
0JA	Hùng Lợi	Hùng Lợi	684	Hùng Lợi
0JB	Thương Xuân	nguyễn thị thương	685	Thương Xuân
0JC	An Bình	Nguyễn Văn Hữu	686	An Bình
0JD	Liên Huỳnh	Liên Huỳnh	687	Liên Huỳnh
0JE	Ngọc Quý	Chị Ngọc	688	Ngọc Quý
0JF	Thảo Tiên	Chị Uyên	689	Thảo Tiên
0JG	Thuần Lê	Chu Thị Lê	690	Thuần Lê
0JH	Căn Tin Bệnh viện  Con cuông	nguyên văn tri	691	Căn Tin Bệnh viện  Con cuông
0JI	Quang Xuân	Vũ Văn Quang	692	Quang Xuân
0JJ	Bảy Bang	Đặng Thị Bảy	693	Bảy Bang
0JK	Dũng Trâm	Nguyễn Xuân Dũng	694	Dũng Trâm
0JL	Hoàng Hạnh	Nguyễn Thị Phượng	695	Hoàng Hạnh
0JM	Tú Lục	Bùi Hữu Lục	696	Tú Lục
0JN	Thủy Cường	Lê Thị Thanh Thủy	697	Thủy Cường
0JO	Chương Vinh	Chị Vinh	698	Chương Vinh
0JP	Quang Thiện	Lê Thị Thiện	699	Quang Thiện
0JQ	Hoài Hùng	LE THI NHAT HOAI	700	Hoài Hùng
0JR	Hằng Vinh Mart	Nguyễn Thị Kim Vân	701	Hằng Vinh Mart
0JS	Liên Thắng	Nguyễn Thị Liên	702	Liên Thắng
0JT	bỉm sữa thịnh mai	vi thị ngọc mai	703	bỉm sữa thịnh mai
0JU	Liệu Hoàn	LE THI HOAN	704	Liệu Hoàn
0JV	Cafe Nhà Trong Ngõ	Nguyễn Thị Nhung	705	Cafe Nhà Trong Ngõ
0JW	Hiệp Cường	Nguyễn Hồng Hiệp	706	Hiệp Cường
0JX	Oanh Sơn	Oanh Sơn	707	Oanh Sơn
0JY	Quỳnh Nhung	Chị Quỳnh	708	Quỳnh Nhung
0JZ	Bé Thái	Nguyễn Thị Bé	709	Bé Thái
0K0	Vi Thị hiền	Chị Hiền	710	Vi Thị hiền
0K1	yến thuật	Lương Thị Yến	711	yến thuật
0K2	Lục Nghệ	Kha Thị Nghệ	712	Lục Nghệ
0K3	Đạt Hương	Đạt Hương	713	Đạt Hương
0K4	Dì Hòe	Nguyễn Thị Hòe	714	Dì Hòe
0K5	Liễu Thành	Nguyễn Thị Liệu	715	Liễu Thành
0K6	Hải Nam	Nguyễn Thị Hải	716	Hải Nam
0K7	Chung Cơ	Chung Cơ	717	Chung Cơ
0K8	Thịnh Liên	Hồ Sỹ Thịnh	718	Thịnh Liên
0K9	Nhung Bắc	Nguyễn Thị Nhung	719	Nhung Bắc
0KA	Thanh Bình	Phan Thị Thanh	720	Thanh Bình
0KB	tiin	duong ngoc truong	721	tiin
0KC	Chung Sửu	Nguyễn Thị Sửu	722	Chung Sửu
0KD	Huy Hương	Nguyễn Thị Hương	723	Huy Hương
0KE	Phú Ngũ	Dì Phú	724	Phú Ngũ
0KF	Duy Béo	Anh Duy	725	Duy Béo
0KG	Lý Thu		726	Lý Thu
0KH	Tuất Hữu	Lữ Thị Hữu	727	Tuất Hữu
0KI	Hồng Hà	Dương Thị Thu Hà	728	Hồng Hà
0KJ	Thùy Tuấn	NGUYEN THI THUY	729	Thùy Tuấn
0KK	Hoa Lợi	Hoa Lợi	730	Hoa Lợi
0KL	Hợp Thoa	Phan Ngọc Hợp	731	Hợp Thoa
0KM	Tiến Thắm	NGUYEN THI THAM	732	Tiến Thắm
0KN	Thương Sơn	Nguyễn Thị Thương	733	Thương Sơn
0KO	Chiến Việt	Hoàng Thị Việt	734	Chiến Việt
0KP	Dì Nhàn	Nguyễn Thị Nhàn	735	Dì Nhàn
0KQ	Mộc Hương		736	Mộc Hương
0KR	Lam Giang	Tố Uyên	737	Lam Giang
0KS	Hoan Hường	Chị Hoan	738	Hoan Hường
0KT	chị thơm hải	A Hùng	739	chị thơm hải
0KU	An  Hùng	PHAN VAN CHIEN	740	An  Hùng
0KV	Thơm Tùng	Chị Thơm	741	Thơm Tùng
0KW	Cafe 1999		742	Cafe 1999
0KX	tai oanh	nguyen thi kieu oanh	743	tai oanh
0KY	hoa ly	Dam hai ly	744	hoa ly
0KZ	nguyen thi mai	mai chuc 2	745	nguyen thi mai
0L0	hop hiep	vi thi hiep	746	hop hiep
0L1	mơ chè	nguyễn thị hằng mơ	747	mơ chè
0L2	tu ngan	ha thi ngan	748	tu ngan
0L3	Dì Mười	Mai Thị Mười	749	Dì Mười
0L4	Toàn Diệu	Nguyễn Văn Toàn	750	Toàn Diệu
0L5	Cường hân	Cao thị hân	751	Cường hân
0L6	Gì Thủy Mậu	NGUYEN DINH MAU	752	Gì Thủy Mậu
0L7	thúy hải	nguyễn thị thúy	753	thúy hải
0L8	Quý Huy	Quý Huy	754	Quý Huy
0L9	Lệ Quyên		755	Lệ Quyên
0LA	gi phúc	nguyen thi phuc	756	gi phúc
0LB	Nga Dương	Vũ Thị Thúy Nga	757	Nga Dương
0LC	Toàn Nguyệt	Hoàng Thị Nguyệt	758	Toàn Nguyệt
0LD	Bà Sửu Châu	Bà Sửu Châu	759	Bà Sửu Châu
0LE	đặng thị chinh	Đặng Thị Chinh	760	đặng thị chinh
0LF	Minh uy	Lê thi uy	761	Minh uy
0LG	Dung Ất	Hoàng Thị Dung	762	Dung Ất
0LH	Bà Thành	Nguyễn Thị Thành	763	Bà Thành
0LI	Phương Thuý	Nguyễn Thị Thùy	764	Phương Thuý
0LJ	Nam Thắng	Nguyễn Thị Nam	765	Nam Thắng
0LK	Bỉm sữa Tâm An	Nguyễn Tuấn Anh	766	Bỉm sữa Tâm An
0LL	Nam Nhàn	Lê Văn Nam	767	Nam Nhàn
0LM	Bình Hoa	Hoàng Thị Xuân Hoài	768	Bình Hoa
0LN	Khải Hương	Nguyễn Thị Hương	769	Khải Hương
0LO	Chính Huyền	Ngô Thị Chính	770	Chính Huyền
0LP	Hoàng Bách	Trần Thị Nhung	771	Hoàng Bách
0LQ	Phương anh	Phan thi vi diệp	772	Phương anh
0LR	Mơ Dũng		773	Mơ Dũng
0LS	Âu Hiếu	Nguyễn Thị Âu	774	Âu Hiếu
0LT	Thương Nga	Ngân Thị Nga	775	Thương Nga
0LU	Thu Bảy	Nguyễn Thị Minh Thu	776	Thu Bảy
0LV	Mai Hương	Hương Giáp	777	Mai Hương
0LW	Hùng Xuân	nguyễn xuân hùng	778	Hùng Xuân
0LX	Thơ Hiệp	Nguyễn Thị Thơ	779	Thơ Hiệp
0LY	Vân Phú	Nguyễn Thị Vân	780	Vân Phú
0LZ	Tài Trang	Tài Trang	781	Tài Trang
0M0	cafe Sơn Ngân	Từ Thị Ngân	782	cafe Sơn Ngân
0M1	Lê Tuyến		783	Lê Tuyến
0M2	Toàn Quỳnh	NGUYỄN THỊ QUỲNH	784	Toàn Quỳnh
0M3	dung ất 2	La Thị Diễn	785	dung ất 2
0M4	Hải chi	Vi thi chi	786	Hải chi
0M5	Bà Hoa		787	Bà Hoa
0M6	Hoàng thành	Chu THỊ Thanh	788	Hoàng thành
0M7	Hương Vinh	Đặng Thị Như Hường	789	Hương Vinh
0M8	Hông Khương	Nguyễn Thi khương	790	Hông Khương
0M9	Hiệu Hiền	Ngân Thị Hiền	791	Hiệu Hiền
0MA	thùy hùng	nguyễn thị thùy	792	thùy hùng
0MB	Hải hoa	Vi văn hải	793	Hải hoa
0MC	tạp hóa hương bảy	lân thị huong	794	tạp hóa hương bảy
0MD	Nam thúy 1	Ngyễn hoài Nam	795	Nam thúy 1
0ME	Thắng Thương	Vi Thị Thương	796	Thắng Thương
0MF	trà sữa thái hoài	thai thi thu hoai	797	trà sữa thái hoài
0MG	Đồng An	Cao Thị An	798	Đồng An
0MH	Vinh Anh	Cao Thị Anh	799	Vinh Anh
0MI	Phương Bình		800	Phương Bình
0MJ	Huyền bảy	Nguyễn Thị Huyền	801	Huyền bảy
0MK	Tấn Thành	Tấn Thành	802	Tấn Thành
0ML	Nam thúy		803	Nam thúy
0MM	Nhuần Yến	HO THICH NHUAN	804	Nhuần Yến
0MN	Chiến Hưng	Chị Chiến	805	Chiến Hưng
0MO	Chị Hồng	Chị Hồng	806	Chị Hồng
0MP	Mai chức		807	Mai chức
0MQ	Nga Phúc	Bùi Thị Nga	808	Nga Phúc
0MR	Dì Vinh	Dì Vinh	809	Dì Vinh
0MS	ngã ba quán	vân anh	810	ngã ba quán
0MT	siêu thi trung Liên	Nguyễn Thị Liên	811	siêu thi trung Liên
0MU	Lâm hạnh	Lang thị Hạnh	812	Lâm hạnh
0MV	Cương Nghĩa	Nguyễn Văn Cương	813	Cương Nghĩa
0MW	Thắng Cúc	hoàng cúc	814	Thắng Cúc
0MX	Hồng Long	Hồng Long	815	Hồng Long
0MY	Thủy hoa	Nguyễn thị Hoa	816	Thủy hoa
0MZ	Cường Đào	Phan thị kim yên	817	Cường Đào
0N0	Tường Huy	A huy	818	Tường Huy
0N1	sỹ thuy	Đinh Thị Thùy	819	sỹ thuy
0N2	Gì Hoài Đại	Hoàng Thị Xuân Hoài	820	Gì Hoài Đại
0N3	Sâm Trung	Phạm Thị Chung	821	Sâm Trung
0N4	Diện Hải	Trần Hữu Hải	822	Diện Hải
0N5	Hạnh Ngọ	Nguyễn Thị Chung	823	Hạnh Ngọ
0N6	Đông Chanh	chị chanh	824	Đông Chanh
0N7	Siêu Thị Vân Cường	Nguyễn Ngọc Cường	825	Siêu Thị Vân Cường
0N8	Oanh Đồng	đào thị ngọc oanh	826	Oanh Đồng
0N9	trà sữa tiamo	Nguyễn Thị Thủy	827	trà sữa tiamo
0NA	bà đáng	nguyen	828	bà đáng
0NB	Vân Anh	vân anh	829	Vân Anh
0NC	Siêu Thị An Thanh	Thái doãn an	830	Siêu Thị An Thanh
0ND	Mười Loan	cao thi loan	831	Mười Loan
0NE	Xuân Tinh	Lô Thị Xuân	832	Xuân Tinh
0NF	Chị Huệ	Chị Huệ	833	Chị Huệ
0NG	Bà Vinh	Hoàng Thị Vinh	834	Bà Vinh
0NH	Tuyet Hung	Hoàng Văn Nam	835	Tuyet Hung
0NI	Hà Hùng		836	Hà Hùng
0NJ	AN ĐỀ	Lương Thị An	837	AN ĐỀ
0NK	Hiền đường	Nguyễn thi Hiền	838	Hiền đường
0NL	Hoa Hùng	Thái Thị Hoa	839	Hoa Hùng
0NM	Hà Hoàng	Nguyễn Thị Hà	840	Hà Hoàng
0NN	Chị Long	Chị Long	841	Chị Long
0NO	Nhim baby	Em Thao	842	Nhim baby
0NP	Anh Thơ	Võ Thị Thương	843	Anh Thơ
0NQ	Lộc Lộc	Nguyễn ngọc diễm	844	Lộc Lộc
0NR	Chị Liễu	Lê Thị Phương Liệu	845	Chị Liễu
0NS	tú quyết	nguyen thi anh tú	846	tú quyết
0NT	Nhân Thương	Dư Thị Hoài Thương	847	Nhân Thương
0NU	tam tuat		848	tam tuat
0NV	kiên tuyết	lương thị tuyết	849	kiên tuyết
0NW	thọ giang	nguyễn thị hà giang	850	thọ giang
0NX	công ty tnhh tm tổng hợp huy hiếu		851	công ty tnhh tm tổng hợp huy hiếu
0NY	Huynh Thi Thu Hien	thu hien	852	Huynh Thi Thu Hien
0NZ	Gì Thuận Mười	nguyễn thị hồng thuận	853	Gì Thuận Mười
0O0	Hoàn Hương	Dang Ba Hoan	854	Hoàn Hương
0O1	xuân chinh	tran thi xuan	855	xuân chinh
0O2	đại dương	hoàng thị dương	856	đại dương
0O3	kiên giang	ngô thị giang	857	kiên giang
0O4	Việt Lý	NGUYEN THI TUYET MAI	858	Việt Lý
0O5	MINI MART SC 68		859	MINI MART SC 68
0O6	Gì Lài	Lê Thị Lai	860	Gì Lài
0O7	Quang Hoa	Lê Thị Hoa	861	Quang Hoa
0O8	Gì Sâm		862	Gì Sâm
0O9	Giang Hiếu		863	Giang Hiếu
0OA	Cafe Hoa Phượng Đỏ	Trần Thị Hoa	864	Cafe Hoa Phượng Đỏ
0OB	Hà Bé 2	Đặng Thị Hồng Nhung	865	Hà Bé 2
0OC	Tuyết Toàn	Tuyết Toàn	866	Tuyết Toàn
0OD	Sỹ Điệp		867	Sỹ Điệp
0OF	Quỳnh Bình	Nguyễn Thị Thanh Bình	868	Quỳnh Bình
0OG	Bình Linh	Lê Thị Thùy Linh	869	Bình Linh
0OH	Chị Thơm	Võ Thị Thơm	870	Chị Thơm
0OI	Lò Bánh Mì Bảo Khang	Lò Bánh Mì Bảo Khang	871	Lò Bánh Mì Bảo Khang
0OJ	gì tâm long	gì tâm long	872	gì tâm long
0OK	Thanh Thùy	Nguyễn Thị Thanh Thủy	873	Thanh Thùy
0OL	hoàng cầm	nguyen thi ngoc câm	874	hoàng cầm
0OM	Mến Ứng	Nguyễn Văn Mến	875	Mến Ứng
0ON	Minh Thường	Hồ Thị Minh	876	Minh Thường
0OO	Tuấn Hoàn		877	Tuấn Hoàn
0OP	Quý Hòa	Nguyễn Thị Xuân Quý	878	Quý Hòa
0OQ	JuLy	Dương Thị Thuyết	879	JuLy
0OR	Lâm Liên	nguyễn thị liên	880	Lâm Liên
0OS	Tuyết Thanh	Phan Thị Thanh	881	Tuyết Thanh
0OT	Khuyên Danh	Nguyễn Thị Khuyên	882	Khuyên Danh
0OU	nguyên thị mai	công mai	883	nguyên thị mai
0OV	Thủy Sáng	Nguyễn Thị Thu	884	Thủy Sáng
0OW	ánh tề	ánh tề	885	ánh tề
0OX	Minh Hà	Dì Hà	886	Minh Hà
0OY	Cúc Lam	Nguyễn Thị Cúc	887	Cúc Lam
0OZ	ba minh	Trần Thị Minh	888	ba minh
0P0	Bộ Lịnh	Anh Lịnh	889	Bộ Lịnh
0P1	Chị Tuyết	Lê Thị Tuyết	890	Chị Tuyết
0P2	Hiền Nhi	Nguyễn Thị Nhi	891	Hiền Nhi
0P3	Thành Phượng	Văn Thị Phượng	892	Thành Phượng
0P4	Minh Tiêu		893	Minh Tiêu
0P5	Hà Đức	Hà Đức	894	Hà Đức
0P6	Dũng Hường	Nguyễn Thị Pa Ty	895	Dũng Hường
0P7	Dì Duyên	Trần Thị Duyên	896	Dì Duyên
0P8	Bách Hoa Dừa	Bùi Công Hùng	897	Bách Hoa Dừa
0P9	chi trang	chi trang	898	chi trang
0PA	24/7 Max	Lê Thị Hoài	899	24/7 Max
0PB	Chị Nhung	Dương Xuân Phượng	900	Chị Nhung
0PC	sáng sương	Nguyễn Thị Sương	901	sáng sương
0PD	Ngọc Nguyệt	Đậu Thị Nguyệt	902	Ngọc Nguyệt
0PE	hường minh	Hường Minh	903	hường minh
0PF	Hoàng Anh CS2	Nguyễn Thị Hạnh	904	Hoàng Anh CS2
0PG	trà chanh 1994	em Minh	905	trà chanh 1994
0PH	Mạnh Mến	Hoàng Thị Mến	906	Mạnh Mến
0PI	Chị Yến	nguyễn thị yến	907	Chị Yến
0PJ	Chị  Giang	ngô thi giang	908	Chị  Giang
0PK	Minh Nga	Trần Thị Nga	909	Minh Nga
0PL	Sửu Hòe	Nguyễn thị Hòe	910	Sửu Hòe
0PM	Bỉm sữa sơn hoài	sieu thi HB2	911	Bỉm sữa sơn hoài
0PN	Thành Hợp	Dương Thị Hợp	912	Thành Hợp
0PO	Cường Mến	Nguyễn Thị Mến	913	Cường Mến
0PP	Dì Liên	nguyên thị liên	914	Dì Liên
0PQ	Thành Hiền	Thái Thị Nga	915	Thành Hiền
0PR	trang thanh	Nguyễn thị trang	916	trang thanh
0PS	Huyền Lân	Phạm Thị Hiền	917	Huyền Lân
0PT	Nhất Trí	Nguyễn Thị tri	918	Nhất Trí
0PU	Hoàng Hiền	Nguyễn Thị Hiền	919	Hoàng Hiền
0PV	Hạnh Quý	Bùi Thị Quý	920	Hạnh Quý
0PW	Mai Tám	Nguyễn Thị Tâm	921	Mai Tám
0PX	Chị Hiền	Nguyễn Thị Hiền	922	Chị Hiền
0PY	Mẹ Bống	Nguyễn Thị Anh	923	Mẹ Bống
0PZ	Chị Hiền Hội	Phạm Thị Hiền	924	Chị Hiền Hội
0Q0	Hà Thắng	Phạm Thị Ly	925	Hà Thắng
0Q1	Huệ Hoa	Đặng Thị Hệ	926	Huệ Hoa
0Q2	Trường Lài	Nguyễn Trí Trường	927	Trường Lài
0Q3	Gì Lợi	Gì Lợi	928	Gì Lợi
0Q4	Chè Thúy	Lê Thị Thu Thúy	929	Chè Thúy
0Q5	Dì Liệu	Nguyễn Thị Liệu	930	Dì Liệu
0Q6	Văn Lai	LÊ THỊ VĂN	931	Văn Lai
0Q7	Hòa Thanh	Hòa Thanh	932	Hòa Thanh
0Q8	Tiến Hương	Tiến Hương	933	Tiến Hương
0Q9	phi yen	ngo khac phi	934	phi yen
0QA	Lộc Hợi	Mai Thị Hợi	935	Lộc Hợi
0QB	Sơn  Khuyên	Đậu Thị Minh khuyên	936	Sơn  Khuyên
0QC	Chị Hà	Chị Hà	937	Chị Hà
0QD	Dì Hà	Dì Hà	938	Dì Hà
0QE	thóc gạo	thái khac thuc	939	thóc gạo
0QF	Thảo Chi	Trần Thị Nụ	940	Thảo Chi
0QG	Siêu Thị Hiền Hòa	Đặng Thị Thu Hiền	941	Siêu Thị Hiền Hòa
0QH	Thắng  Hải	Thắng  Hải	942	Thắng  Hải
0QI	Lương Trọng		943	Lương Trọng
0QJ	Việt Đường	Trần Thị Đường	944	Việt Đường
0QK	Hải Tài	Nguyễn Thị Hải	945	Hải Tài
0QL	Thuận Phương	Phạm Thị Thúy Phương	946	Thuận Phương
0QM	Nguyễn Thị Hồng	Nguyễn Thị Hồng	947	Nguyễn Thị Hồng
0QN	Nhuận Thanh	Nhuận Thanh	948	Nhuận Thanh
0QO	Chuỗi cửa hàng mẹ và bé	Chuỗi cửa hàng mẹ và bé	949	Chuỗi cửa hàng mẹ và bé
0QP	cafe Phong Lan	cafe hải	950	cafe Phong Lan
0QQ	Huyền Thương	Đặng Thị Huyền Thương	951	Huyền Thương
0QR	Mây Lương	trân thị thơ mây	952	Mây Lương
0QS	Hương Lịch	Trần Thị Hương	953	Hương Lịch
0QT	Dung Sen Quyên		954	Dung Sen Quyên
0QU	đặng thị hương	đăng thị hương	955	đặng thị hương
0QV	chị vân	nguyễn thị vân	956	chị vân
0QW	quầy thuốc thư trinh	trịnh thị loan	957	quầy thuốc thư trinh
0QX	cà phê tino	hoàng văn huy	958	cà phê tino
0QY	ngoc phương	duong thi phương	959	ngoc phương
0QZ	Cafe Linh Đan	Nguyễn Thị Thu Dịu	960	Cafe Linh Đan
0R0	Phương Cường	Hoàng Thị Phương	961	Phương Cường
0R1	nguyễn văn hồng		962	nguyễn văn hồng
0R2	chị thủy tuyen	nguyễn thị long	963	chị thủy tuyen
0R3	Vinh Lý	Vinh Lý	964	Vinh Lý
0R4	Đức Giang	Nguyễn Thị Giang	965	Đức Giang
0R5	Thuốc Tây Chị Bình	Tôi Thị Bình	966	Thuốc Tây Chị Bình
0R6	Hải Bốn	Vi Thị Hải	967	Hải Bốn
0R8	Vi Phương Quý	Chị Quý	968	Vi Phương Quý
0R9	Phúc Hoa	chị Hoa	969	Phúc Hoa
0RA	tạp hóa tùng khánh	bùi thị khánh	970	tạp hóa tùng khánh
0RB	Giải quyết khiếu nại		971	Giải quyết khiếu nại
0RC	May Hà	May Hà	972	May Hà
0RD	quyết hoài	đặng văn quyết	973	quyết hoài
0RE	cô ba chòe	vang thị lệ	974	cô ba chòe
ILJ	CÔNG TY TNHH ĐẦU TƯ KINH DOANH HOÀNG SƠN	HOÀNG TRẦN SƠN	975	CÔNG TY TNHH ĐẦU TƯ KINH DOANH HOÀNG SƠN
ILK	tiến hà	ngô thị hà	976	tiến hà
ILL	bỉm sữa bảo anh	trần xuân thao	977	bỉm sữa bảo anh
ILM	Tùng Lâm	Nguyễn Thị Vân	978	Tùng Lâm
ILN	vinh tho	nguyen thi vinh	979	vinh tho
ILO	ba đào đại	trương đình đại	462	Đào Đại
ILP	hoa thương	hoa thương	981	hoa thương
ILQ	chị BẰNG	hoàng thị bằng	982	chị BẰNG
ILR	KH  hưng huế	nguyễn van hưng	983	KH  hưng huế
ILS	Chín Tùy	chị tùy	984	Chín Tùy
ILT	Thuong Hoi	Phan Thi Thuong	985	Thuong Hoi
ILU	kim thảo	hà thị kim	986	kim thảo
ILV	mini mart	cao xuân đức	987	mini mart
ILW	Phuong Gai	Vo ThiGai	988	Phuong Gai
ILX	Lập Lan	Trình Thành Thái	989	Lập Lan
ILY	c liễu sơn	trần thị liễu	990	c liễu sơn
ILZ	KHO KỸ THUẬT K2 - CỤC HC-KT,QUÂN KHU 4	Anh Lê	991	KHO KỸ THUẬT K2 - CỤC HC-KT,QUÂN KHU 4
IM0	Tran Quang Trung	Tran Quang Trung	992	Tran Quang Trung
IM1	Hoan Huan	Dao Thi Hoan	993	Hoan Huan
IM2	sữa bỉm truc quỳnh	đàm thị dung	994	sữa bỉm truc quỳnh
IM3	Thom Thien	Tran Thi Thom	995	Thom Thien
IM4	M&B BÉ MY	nguyen thị hai yên	996	M&B BÉ MY
IM5	Tăng Văn Chí	tùng hải	997	Tăng Văn Chí
IM6	Son Loc	Pham Ngoc Son	998	Son Loc
IM7	ME BÉ INNOVA	ngô văn tuân	999	ME BÉ INNOVA
IM8	Lực Hồng	nguyễn thị liễu	1000	Lực Hồng
IM9	Van Thanh	Nguyen Thi Thanh	1001	Van Thanh
IMA	cảnh chín	phạm thị hóa	1002	cảnh chín
IMB	Long Phương	cao lan phương	1003	Long Phương
IMC	Võ Hạ	Nguyễn Thị Hạ	1004	Võ Hạ
IMD	Thủy Hữu	Dì thủy	1005	Thủy Hữu
IME	Tai Anh	Tai anh	1006	Tai Anh
IMF	Tinh Quy	Tinh quy	1007	Tinh Quy
IMG	Nga Chinh	Nguyễn Thị Nga	1008	Nga Chinh
IMH	Thành Thủy	Ngô Thị Thủy	1009	Thành Thủy
IMI	Phong Hương	Nguyên Thi Hương	1010	Phong Hương
IMJ	thu phong	đặng thị thanh hiếu	1011	thu phong
IMK	Dương Thị Vĩnh	Dương Thị Vĩnh	1012	Dương Thị Vĩnh
IML	Hồng Tám	trân thị tám	1013	Hồng Tám
IMM	Linh Anh	Phạm Thị Cúc	1014	Linh Anh
IMN	Bs Đức Anh	Nguyễn Văn Đức	1015	Bs Đức Anh
IMO	Trà sữa Boba	Hoang Thị Hoan	1016	Trà sữa Boba
IMP	Hưng Hiển	Nguyễn Thị Hiển	1017	Hưng Hiển
IMQ	bỉm sữa mẹ tép	hồ thị bích ngọc	1018	bỉm sữa mẹ tép
IMR	khu vui chơi đức duy	nguyễn thị hường	1019	khu vui chơi đức duy
IMS	Bùi thị Hiền	Bùi thị Hiền	1020	Bùi thị Hiền
IMT	Nga Dũng	Nguyễn Thị Tuyết Nga	1021	Nga Dũng
IMU	ca fe  long cuong	ngô phương thảo	1022	ca fe  long cuong
IMV	Em Nhã	Em Nhã	171	Tuấn Nhã
IMW	Long Oanh	Dì Oanh	1024	Long Oanh
IMX	Cửa hàng tổng hợp	chị ngọc	1025	Cửa hàng tổng hợp
IMY	Phan Việt Phương	A Phương(sát hạch)	1026	Phan Việt Phương
IMZ	Đào Điền	Đặng Thị Đào	1027	Đào Điền
IN0	Dương Póm	Dì Póm	1028	Dương Póm
IN1	Tuân Duyên	Chị Duyên	1029	Tuân Duyên
IN2	Tư Thồn	Chị Tư	1030	Tư Thồn
IN3	Hùng Quy	vương thi vân	460	Quy Hùng
IN4	Thủy Dung	Chị Dung	1032	Thủy Dung
IN5	Huệ Nam	Bà Huệ	1033	Huệ Nam
IN6	Mẹ Bé Cu Thóc	Quỳnh July	1034	Mẹ Bé Cu Thóc
IN7	Voi Coffee	Võ Thị Nga	1035	Voi Coffee
IN8	Dì Hồng	Dì Hồng	1036	Dì Hồng
IN9	Tiệm 1993	A Nhâm	1037	Tiệm 1993
INA	Hiền Hồng	Anh Hồng	1038	Hiền Hồng
INB	Anh Em Quán	Chị Hương	1039	Anh Em Quán
INC	Toàn Thủy	Bà Thủy	1040	Toàn Thủy
IND	Vượng Lý	Cao Thị Lý	1041	Vượng Lý
INE	Lợi Điện	Chị Lợi	1042	Lợi Điện
INF	Mằn Ỏn	Quang Thị Ỏn	1043	Mằn Ỏn
ING	Moon coffee	Trần Đăng Việt	1044	Moon coffee
INH	Bích Thủy	Lô Thị Huệ	1045	Bích Thủy
INI	Toàn Quế	Nguyễn Thị Thươnng Thương	1046	Toàn Quế
INJ	Minh Hường	Hoàng Thị Minh	1047	Minh Hường
INK	tạp hóa giang minh	nguyễn thị giang	1048	tạp hóa giang minh
INL	Việt Nam	Chị Lâm	1049	Việt Nam
INM	Lạng Đông	đoàn thị trang	1050	Lạng Đông
INN	Hiền Hoàng 2	Lê công lưu	455	Hiền Hoàng
INO	Rê Lương	Lương thị đào	1052	Rê Lương
INP	Cafe Chơ	tran thi thanh tâm	1053	Cafe Chơ
INQ	Hương Mại	Nguyễn Thị Hương A	1054	Hương Mại
INR	nguyen thi thuy	nguyen thi thuy	1055	nguyen thi thuy
INS	Tự Tấn	phạm văn hoàng	441	Tấn Tự
INT	chi  phường dung	trần thị dung	1057	chi  phường dung
INU	Caffe Hai Map	Thai thi Hai	1058	Caffe Hai Map
INV	Quế Soa	nguyễn thị kim thoa	1059	Quế Soa
INW	cà phê trà sữa dung thuận	nguyễn thị dung	1060	cà phê trà sữa dung thuận
INX	trạm coffee tea	nguyễn văn thao	1061	trạm coffee tea
INY	hải tuyết	võ thị tuyết	1062	hải tuyết day la danh sach cac ma khach hang di kem voi cua hang cua no. hay tao khoi tao lai du lieu cho toi. cong ty quan ly mac dinh de 001"""


def main():
    lines = RAW_DATA.strip().split("\n")
    rows = []
    for line in lines:
        parts = line.split("\t")
        cust_code = parts[0].strip()
        cust_name = parts[1].strip() if len(parts) > 1 else ""
        contact = parts[2].strip() if len(parts) > 2 else ""
        store_code_raw = parts[3].strip() if len(parts) > 3 else ""
        store_name = parts[4].strip() if len(parts) > 4 else ""
        if "day la danh sach" in store_name:
            store_name = store_name.split("day la danh sach")[0].strip()

        if store_code_raw == "350" and not store_name:
            store_name = "Chị Thủy"
        elif store_code_raw == "366" and not store_name:
            store_name = "Thủy Hùng"

        store_code = f"CH-{int(store_code_raw):04d}" if store_code_raw.isdigit() else store_code_raw

        rows.append({
            "cust_code": cust_code,
            "cust_name": cust_name,
            "contact": contact,
            "store_code_raw": store_code_raw,
            "store_code": store_code,
            "store_name": store_name,
        })

    print(f"Tổng số dòng khách hàng: {len(rows)}")

    with engine.begin() as conn:
        # 1. Công ty quản lý mặc định '001'
        comp = conn.execute(text("SELECT id, code, name FROM companies WHERE code = '001'")).fetchone()
        if not comp:
            res = conn.execute(
                text("INSERT INTO companies (code, name, status, created_at) VALUES ('001', 'Cty Trung Đông', 'active', NOW()) RETURNING id")
            )
            company_id = res.scalar()
        else:
            company_id = comp[0]
        print(f"Công ty quản lý: id={company_id}, code='001'")

        # 2. Cập nhật Stores (owner_name, name)
        store_updates = {}
        for r in rows:
            sc = r["store_code"]
            if sc not in store_updates:
                store_updates[sc] = {"name": r["store_name"], "owner_name": r["contact"]}
            else:
                if not store_updates[sc]["name"] and r["store_name"]:
                    store_updates[sc]["name"] = r["store_name"]
                if not store_updates[sc]["owner_name"] and r["contact"]:
                    store_updates[sc]["owner_name"] = r["contact"]

        # Batch update stores
        for sc, sdata in store_updates.items():
            params = {"code": sc}
            set_clauses = []
            if sdata["name"]:
                set_clauses.append("name = :name")
                params["name"] = sdata["name"]
            if sdata["owner_name"]:
                set_clauses.append("owner_name = :owner_name")
                params["owner_name"] = sdata["owner_name"]
            if set_clauses:
                sql = f"UPDATE stores SET {', '.join(set_clauses)} WHERE code = :code"
                conn.execute(text(sql), params)

        stores_map = dict(conn.execute(text("SELECT code, id FROM stores")).fetchall())
        print(f"Đã cập nhật thông tin cho {len(store_updates)} cửa hàng.")

        # 3. Đồng bộ Customers
        existing_custs = dict(conn.execute(text("SELECT code, id FROM customers")).fetchall())
        now = datetime.now(timezone.utc)

        update_params = []
        insert_params = []

        for r in rows:
            cc = r["cust_code"]
            cname = r["cust_name"]
            sid = stores_map.get(r["store_code"])

            if cc in existing_custs:
                update_params.append({
                    "code": cc,
                    "name": cname,
                    "store_id": sid,
                    "company_id": company_id,
                })
            else:
                insert_params.append({
                    "code": cc,
                    "name": cname,
                    "type": "RETAIL",
                    "tier": "B",
                    "credit_limit": 0.0,
                    "current_debt": 0.0,
                    "status": "active",
                    "store_id": sid,
                    "company_id": company_id,
                    "created_at": now,
                })

        if update_params:
            conn.execute(
                text("""
                    UPDATE customers
                    SET name = :name,
                        store_id = :store_id,
                        company_id = :company_id
                    WHERE code = :code
                """),
                update_params,
            )
            print(f"Đã cập nhật {len(update_params)} khách hàng.")

        if insert_params:
            conn.execute(
                text("""
                    INSERT INTO customers (code, name, type, tier, credit_limit, current_debt, status, store_id, company_id, created_at)
                    VALUES (:code, :name, :type, :tier, :credit_limit, :current_debt, :status, :store_id, :company_id, :created_at)
                """),
                insert_params,
            )
            print(f"Đã thêm mới {len(insert_params)} khách hàng.")

        # Lấy lại đầy đủ bản đồ customers sau khi insert
        all_custs = dict(conn.execute(text("SELECT code, id FROM customers")).fetchall())

        # 4. Cập nhật/thêm liên hệ (customer_contacts) với phone = '' (không NULL)
        existing_contacts = dict(conn.execute(text("SELECT customer_id, id FROM customer_contacts WHERE is_primary = true")).fetchall())

        contact_updates = []
        contact_inserts = []

        for r in rows:
            contact = r["contact"]
            if not contact:
                continue
            cid = all_custs.get(r["cust_code"])
            if not cid:
                continue

            if cid in existing_contacts:
                contact_updates.append({"id": existing_contacts[cid], "name": contact})
            else:
                contact_inserts.append({"cid": cid, "name": contact, "phone": ""})

        if contact_updates:
            conn.execute(
                text("UPDATE customer_contacts SET name = :name WHERE id = :id"),
                contact_updates,
            )
            print(f"Đã cập nhật {len(contact_updates)} liên hệ chính.")

        if contact_inserts:
            conn.execute(
                text("""
                    INSERT INTO customer_contacts (customer_id, name, phone, position, is_primary)
                    VALUES (:cid, :name, :phone, 'Liên hệ chính', true)
                """),
                contact_inserts,
            )
            print(f"Đã thêm mới {len(contact_inserts)} liên hệ chính.")

    # 5. Kiểm tra kết quả
    with engine.connect() as conn:
        linked_cust = conn.execute(text("SELECT count(*) FROM customers WHERE store_id IS NOT NULL")).scalar()
        linked_comp = conn.execute(text("SELECT count(*) FROM customers WHERE company_id = :cid"), {"cid": company_id}).scalar()
        stores_with_owner = conn.execute(text("SELECT count(*) FROM stores WHERE owner_name IS NOT NULL")).scalar()
        print("\n--- TỔNG KẾT HỆ THỐNG ---")
        print(f"Tổng số KH đã gắn Cửa hàng: {linked_cust}")
        print(f"Tổng số KH thuộc Công ty 001: {linked_comp}")
        print(f"Số Cửa hàng đã có tên Người liên hệ / Chủ hộ: {stores_with_owner}")

        sample = conn.execute(text("""
            SELECT c.code AS ma_kh, c.name AS ten_kh, cc.name AS nguoi_lh, s.code AS ma_ch, s.name AS ten_ch, comp.code AS ma_cty
            FROM customers c
            LEFT JOIN stores s ON c.store_id = s.id
            LEFT JOIN companies comp ON c.company_id = comp.id
            LEFT JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.is_primary = true
            WHERE c.code IN ('001', '01E', '024', '09Y', '0AE', 'INY')
            ORDER BY c.code
        """)).fetchall()
        print("\nMẫu kiểm tra:")
        for r in sample:
            print(r)


if __name__ == "__main__":
    main()
