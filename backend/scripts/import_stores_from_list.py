import os
import sys
from datetime import datetime, timezone

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)
sys.stdout.reconfigure(encoding="utf-8")

from app.core.database import engine
from sqlalchemy import text

RAW_DATA = """1	Hà Ân
2	Hoa Quang
3	Kỳ Phương
4	CAFE BỜ HỒ
5	c hoa thọ
6	Hồng Sen
7	Vân Năm
8	Chị Lan
9	Chị Hải
10	Nhung Lý
11	Phương Vi
12	bánh mỳ tiến đat
13	Hoa Hà
14	th thảo linh
15	Thành Vinh
16	Nam Loan
17	Chị Phương
18	Hùng Hải
19	Châu Hà
20	Vinh Tuyết
21	Dì Tám Huệ
22	Cường Hiền
23	ca fe anh duy
24	Tuấn Hữu
25	ca fe huy hoa
26	chi quý
27	chi hằng anh
28	Táo Mart
29	c huong
30	Cường Trang
31	c lien hông
32	Nam Hoàn
33	Hà Hải
34	Phương Hương
35	Chị Hoa Toan
36	Nghĩa Thành
37	Loan Hải
38	Thu Quảng
39	Đài Tú
40	Thành Đô
41	cục quân khu 4
42	Sơn Hằng
43	Phương Hồng
44	lý ngà
45	Thái An
46	Gì Nhâm
47	hoa khanh
48	Hiếu Nhi
49	Tám Thanh
76	Thủy Hùng
51	Sơn La Mini mart
52	Moon Qúan
53	lam quang
54	chi vinh tt
55	Đức Hải
56	Thảo Hùng
57	Tuấn  Thành
58	Cafe Cường Anh
59	Liên Thu
60	Cafe wild west
61	Giang Dũng
62	Sinh Thuỷ
63	Vinh Hải
64	Bảo Duy
65	Trung Liên
66	Siêu Thị Binh Binh
67	chi phương anh
68	Lam Nga
69	Hoan Kiên
70	Hoà Xuân
71	Giap Hà
72	Hoàn Thi
73	ngọc anh
74	Hoài Thủy
75	việt anh
77	Hoàn Huyền
78	chi huong
79	Thảo Nguyên
80	Nguyễn Sỹ Ba
82	Thanh Minh
83	Yến Bốn
84	Loan Phượng
85	chi vân  thọ
86	Bảy Sơn
87	Huệ Hồng
88	ca fe santo
89	Lan Lộc
90	Hải Dũng
91	cà phê anh mạnh
92	Cafe 1.7
93	Hoàng Liệu
94	Thái Hoa
95	Thủy Hà
96	Tuyết Hòa
97	minh quý
98	Nhâm Tư
99	Thanh Giap
100	bánhmi  tt
101	Ngọc Bảy
102	Gì Vân Tâm
103	st nhà sách đl
104	hoài thu
105	sc binh minh
106	Hoài Linh
107	chu lời
108	Hùng Mai
109	Hùng Hoài
110	Xuân Hòa
111	Quỳnh Cường
112	Nhàn thắng
113	Thanh Hà Mart
114	Hằng Toàn
115	Hằng Du
116	Ngọc Trang
117	Hải Huyền mart
118	Thìn Thạch
119	Vượng Lệ
120	Xuân Vinh
121	Hồng Năm
122	Xanh Mart
123	Oanh Nam
124	Ngọc Hiền
125	Liên Hải
126	Hà Bốn
127	Hào Lý
128	Hoài Đồng
129	Hương Cân
130	Tứ Lý
131	Tiên Thắng
132	Thuận Điệp
133	Thương Thụ
134	Hường Hòa
135	Phương Hùng
136	Gì Sửu
137	Hồng Hòa
138	Hoang Anh Cafe
139	Chị Hà
140	Hóa Diệu
141	Hòa Thảo
142	Tư Đức
143	Vinh Trang
144	Cafe Tùng
145	Thanh Phương
146	Tâm La
147	Cafe Mộc
148	Hà Hùng
149	Ngân Lê
150	Thu Trung
151	Lan Chiến
152	Hương Mật
153	Mạnh Quân
154	Liên Thành
155	Lương Toàn
156	Quang hợp
157	Phương Hùng
158	Bà Hồng
159	Oanh Bình
160	Tuấn Sen
161	Tuấn Hà
162	Trà Chanh Tiệm
163	Nguyệt Lý
164	Chín Vân
165	Chị Hồng bánh mướt
166	Phương Mạo
167	Trường An
168	Châu Kim
169	Siêu Thị Linh Đan
170	Diệu Sơn
171	Tuấn Nhã
172	Thương Phú
173	Siêu thị Anh Thắng Mart
174	Đức Long
175	Hiền Lý
176	Chị oanh huệ
177	Bằng Minh
178	Hà Bé
179	Nga Hồng
180	Huyền Nhạc
181	Siêu Thị Ngọc Hải
182	Vinh Thắng
183	a thọ hoa
184	Hương Việt
185	Chị Hồng
186	Hồng Lợi
187	Xuân Thành
188	Chị Nga
189	Trí Ngọt
190	Dì Tùng
191	Chuyên Nga
192	Thúy Tân
193	Trị Sen
194	Son ly
195	Bà Hợi
196	Hà Thu
197	Dì Thuận
198	Ngân Trường
199	Bà Hồng
200	Bà Mùi
201	Nguyễn Thị Tình
202	Ngoc Sen
203	Hồng Hiền
204	KIM CAFE
205	Dì Oanh
206	Lam Hải
207	Vinh Chu
208	Thành Phương
209	Minh Châu
210	Tuấn Toàn
211	Thái Thị Đức
212	Dì Lan
213	kh HOA CHIẾN
214	Gì Hương
215	hải thắng
216	688 Quang Sơn
217	me be BABY STORE
218	Nguyệt Anh
219	Chị Hòa
220	Vân Tý
221	Kim Ngân
222	Thơm Thanh
223	Thu Đông
224	Shop Hải An
225	Bà Mùi
226	Thương Hào
227	ST Linh Hương
228	Hà Tâm
229	Siêu Thị Mẹ Và Bé Thanh Bình
230	chị nhâm
231	Thuận Thanh
232	Dung Danh
233	Lương Đông
234	Hà Sáu
235	Quầy Thuốc Dương Thị Sáu
236	Chung Linh
237	kh ngoc hải
238	Hoa Cương
239	Hương Bảy
240	Thủy Tú
241	Hằng phú
242	CT may Minh Anh
243	Thí Lưu
244	Anh Nga
245	Em Minh
246	Châu Lương
247	Chị Liên
248	Cfe ngoc hải
249	Thúy Toàn
250	Nguyễn Thị Thủy
251	Quang Phương
252	Nhâm Hợi
253	Hoa Dụ
254	Chung Hồng
255	Hạnh Hào
256	Chị Thoa
257	Chị Ngọc Hải
258	Em Thảo
259	Nhàn Lĩnh
260	Bà Hành
261	Diệu Anh
262	Hạnh Tuyết
263	Bình Trà
264	Trang Diễn
265	Thắng Kim
266	cốm baby
267	Hải Anh
268	Hiền Hùng
269	hiền phương
270	Linh Trang
271	KMart+
272	Hà Bé
273	Em Ly
274	Lan Thuận
275	Hậu Lộc
276	kh Linh linh
277	kh  MINH ĐẠT
278	Siêu Thị Hạnh Cường
279	Dương Luyện
280	Hồng Vân
281	chị vân anh
282	Hà Châu
283	Siêu thị mẹ và bé Em trang
284	Ngọc Nương
285	Hương Cường
286	Tuyết Túy
287	Hoan Tý
288	phương phú
289	Minh Thuận
290	Trang Tuấn
291	Hường Văn
292	Hà Mạnh
293	Hùng Tâm
294	Tình Huấn
295	Mẹ và bé Em Hiền
296	Hiền Hòa
298	Loan Thanh
299	Hương Hùng
300	Hợp Yến
301	minh đông
302	Huyền Trân
303	HƯƠNG ANH BABY
304	Tuyết Bảo
305	Phúc Thông
306	Chị Nhung Trường
307	Dũng Huyền
309	kh  Phương Quyên
310	Hằng Bính
311	Hiền Thịnh
312	Tùng Hồng
313	Thanh Toàn
314	ba thảo
315	Sữa 3 tốt
316	Mai An
317	Chị Quý
318	Hương Điều
319	Bỉm Sữa Thanh Bình
320	Hòa Tùng
321	Châu Hà
322	Chị Ngọc Hà
323	Lan Hồng
324	Đại Phước
325	Bỉm sữa nội oanh
326	Nguyệt Thắng
327	Tâm Sửu
328	Cà phê Lion
329	Huyền Anh
330	Hòa Sự
331	Lam Lệnh
332	Chị Phương Linh
333	Hoa Ngọc
334	Anh Quý
335	Lý Khánh
336	Đồng viên mart
337	Kiên Hường
338	Hữu Hào
339	Bảo Long
340	Thắng Hường
341	Chị Phượng
342	Hiền Tâm
343	Mai Hoàng
344	Siêu Thị Minh Dung
345	Chị Thu Dũng
346	Bà Niên
347	Hùng Lưu 2
348	Nhi Đông
349	Gì Hòa
350	
351	Thành Chung
352	Hùng Lưu
353	Tuấn Hằng
354	ưng toàn
355	Bỉm sữa 886
356	Lan Hong
357	Chị Hoài
358	cafe IQ
359	Cảnh Vóc
360	Văn Thoả
361	Bảy Lý
362	Dung Tuấn
363	Hoa Lượng
364	Thuý Hoan
365	Cafe mẹ gông
366	
367	Thành Hồng
368	Chuyên Khánh
369	Ninh Nga
370	Tuấn Thế
371	Toàn Thắng
373	Ngọc Sơn
374	Chị Lan Hùng
375	Hoàng sơn
376	chi mai hồng
377	chinh bình
378	Chị Hoa Dũng
379	Phước Oanh
380	Pham Thi Phuong
381	Hương Định
382	Hoài chương
383	Nhà Thuốc Thiện Nhân
384	Hồng Dương
385	Thắm Hạnh
386	Linh Hòa
387	Lý Hùng
388	Thành Nga
389	Hồng Trung
390	Phương Hồng
391	Thảo augt
392	Sửu Thắng
393	Chị Mai
394	Phương Giang
395	Håi năng
396	Tâm Huy
397	Quý Luyến
398	Quỳnh Danh
399	Ngọc Hành
400	Yến Dũng
401	Tùng Oanh
402	cà phê H2
403	Hổ quán
404	Chị Hoa
405	hanh hoe
406	Chính Thuận
407	Ngọc Phương
408	Sỹ Mận
409	Thu Lưu
410	Thảo Hoa
411	Trường Nho
412	Xuân Đức
413	Thanh á
414	Huyền Chiến
415	Đãi Liễu
416	Thúy hoài
417	Đức Mai
418	Bà hợi
419	Hữu Thoa
420	Lâm việt
421	Thành Vân
422	Thanh Ngân
423	thúy Huế
424	Ngọc Cảnh
425	gì tình lương
426	Hằng Sơn
427	Phương Anh
428	Đoài Oanh
429	Tính Hoài
430	Cà phê Núi
431	Thảo Đinh
432	Bình Trọng
433	Linh Hưng
434	Bé Lân
435	Lan Hiền
436	Thanh Sơn Tky
437	Thái Huy
438	Lương Tâm
439	Thiện Miên
440	Tường Hùng
441	Tấn Tự
442	Vinh Hạnh
443	Thu Sự
444	Qúy Minh
445	kh gi long việt
446	Bác Kỷ
447	Chị Quý
448	Khang Phương
449	Nga Khoa
450	Chị Hằng
451	Loan Thế
452	Anh Liên
453	Tài Khuyên
454	Khánh Hà
455	Hiền Hoàng
456	dì nhượng
457	Bác Dung
458	Thảo Vy
459	Truyền Linh
460	Quy Hùng
461	Tứ Mùi
462	Đào Đại
463	688 Nghĩa Hoàn
464	Hùng Sen
465	Khánh Cường
466	Cúc Duy
467	Hoài Mạnh
468	Hùng Thủy
469	KH Thắng nhuộm
470	Đồng Dung
471	Bánh SN Bình Thùy
472	Hùng Phương
473	Thủy Hạnh
474	Thành Ngọ
475	Tuấn Thủy
476	Lương Sâm
477	Thuận An
478	Chị Hằng
479	Thanh Loan
480	lương trọng
481	Hường Hải
482	Phương Lâm
483	Tâm An
484	Hương Thông
485	Chung Lưu
486	Thủy Tuyến
487	An Oanh
488	Hoài Anh
489	Bảo Như
490	Đức hằng
491	Em Nhàn
492	Đồng Đào
493	Vinh Long
494	Tạp Hóa Hải Hòa
495	Thúy Đồng
496	Hằng Hào
497	Bà Vân
498	Hoa Quang
499	Đức Lựu
500	Lý Biên
501	Cafe Hải
502	Đào Hải
503	Giang Quý
504	ba đào
505	Sơn Ngoan
506	Lợi Sơn
507	Chị Hải
508	Quý Hằng
509	Tuyết Triều
510	Hòa Duyên
511	Trà Mi
512	Hải yến
514	Hiền Sơn
515	Chín Vân
516	sỹ hoa
517	Thành Sơn
518	cường vân
519	Giáp Ngân
520	Hoa lâm
521	Oanh Hùng
522	Hiền Huyền
523	Vân Thành
524	Bà Hà
525	Huệ Đức
526	phượng thức
527	thơm vinh
528	Hải mạnh
529	hà thu
530	bim sữa thưởng loan
531	học hoan
532	Bà liên thọ sơn
533	Hoa sơn
534	Hoạch Hằng
535	Trung Nguyệt
536	Thu Hùng
537	Em Linh Bán Chè
538	Thảo Tú
539	Hoài Thành
540	Cafe Lối Nhỏ
541	Tuyết Quang
542	Tuyết Trì
543	Dung Mạnh
544	Chị Hà
545	CF Bảy tuất
546	Hương Vịnh
547	Thai Hương
548	QUÁN 156
549	Sơn Chí
550	ST KHO BỈM ANH SƠN
551	Khoa Trình
552	Nhâm Kiều
553	Pháo Cà Phê
554	Hồng Hà
555	Thương Vinh
556	Gì Loan
557	Bỉm sữa Linh Dân
558	Tân Sơn
559	Ngọc Hùng
560	Hải Nhuần
561	Quang Tịnh
562	Nam Hiền
563	Huyền Tuệ
564	Bánh mì Bảo Ngọc
565	Cafe Mê Giông
566	Nguyễn Nho
567	tiệm nhà vũ
568	Minh Tiêu 2
569	Tân Phương
570	Song Tinh
571	Thành Xuân
572	Hoa Hồng
573	Lý Vượng
574	Quang Thắm
575	Đồng Dung
576	Nguyen Thi Huong
577	Hương Hà
578	Ngọc Quân
579	Sơn Oanh
580	Siêu Thị Thùy Trà
581	Nguyễn Thị Chinh
582	Hoàng Anh Mart
583	Hệ Thống Siêu Thị Mẹ và Bé - CHANG HOUSE
584	Em Nhàn Bệnh Viện
585	Lý Thành
586	Chiên Thanh
587	Hùng Hương
588	Hải Mai
589	Bà Thành
590	Thịnh Huyền
591	Huệ Tài
592	Siêu thị Kim Nhan
593	Mẹ & Bé Minh Dung Phan
594	Chị Ly
595	Phượng Hải
596	Hưng Thắng
598	kim nhan coffee
599	Chung Linh
600	Trúc Toàn
601	Chị  Sương
602	Anh Nam
603	bỉm sữa sỹ quỳnh
604	Vân Khánh 68
605	Cường thuận
606	kio quán
607	Kim Quỳnh
608	Huệ Lâm
609	Thuận Nguyệt
610	Cẩm Được
611	Mỹ Hào cs2
612	Toàn Thơm
613	Siêu thị mini Thức Hường
614	Thủy Bảy
615	Dì Lan Hà
616	Tạp hóa Hường Bắc
617	Khoa Thạch
618	Sữa Bỉm Trung Nga
619	Chị Hoa Cát
620	Hương Việt
621	bỉm sữa cường huyền
622	Bà Tường
623	Thanh  Dần
624	Lương Linh
625	siêu thị mini đạt phúc
626	nguyệt hùng
627	Bà Lượng
629	Xin Tư
630	My Thái
631	Liên Quảng
632	Chị Lý
633	Mỹ Hào
634	Hương Thương
635	Mẹ và bé An Hùng
636	Năm Anh Em
637	Tăng Sửu
638	Phương Bình Mart
639	Trà Sữa Cua
640	Ngà Tú
641	Hoài Đại
642	Ngọc Anh
643	Thái Nguyên
644	Hùng Ngọ
645	Thanh Phúc
646	Quang Thuỷ
647	Tâm Thao
648	Bánh Mì Đồng Tâm
649	Bỉm sữa Thúy Trần
650	Bình Xô
651	Hữu ỏn
652	tráng  lý
653	Tuấn Hạnh
654	Thắng Hạnh
655	Trâm ba
656	phương thảo
657	Thành Lưu
658	Sơn Đông
659	Nguyễn Thương
660	Nhung Thanh
661	Hà Hoàn
662	Miên Việt
663	Tecco quán
664	Lý Thường
665	Đồng Chi
666	Bà Lìn
667	Sang Xuyên
668	Ngọc Thúy
669	Like Coffe
670	Ngọc Hằng
671	Hưng Phượng
672	chị Thư
673	Lam Thắng
674	Khiêm Hòa
675	Quân Trà
676	Tùng Nhung
677	May Tuyển
678	Chị Thắng
679	Hồng Sơn
680	Huyến Láu
681	Vân Dũng
682	Nguyên Huyền (Hồng Hà 2)
683	Phúc Liễu
684	Hùng Lợi
685	Thương Xuân
686	An Bình
687	Liên Huỳnh
688	Ngọc Quý
689	Thảo Tiên
690	Thuần Lê
691	Căn Tin Bệnh viện  Con cuông
692	Quang Xuân
693	Bảy Bang
694	Dũng Trâm
695	Hoàng Hạnh
696	Tú Lục
697	Thủy Cường
698	Chương Vinh
699	Quang Thiện
700	Hoài Hùng
701	Hằng Vinh Mart
702	Liên Thắng
703	bỉm sữa thịnh mai
704	Liệu Hoàn
705	Cafe Nhà Trong Ngõ
706	Hiệp Cường
707	Oanh Sơn
708	Quỳnh Nhung
709	Bé Thái
710	Vi Thị hiền
711	yến thuật
712	Lục Nghệ
713	Đạt Hương
714	Dì Hòe
715	Liễu Thành
716	Hải Nam
717	Chung Cơ
718	Thịnh Liên
719	Nhung Bắc
720	Thanh Bình
721	tiin
722	Chung Sửu
723	Huy Hương
724	Phú Ngũ
725	Duy Béo
726	Lý Thu
727	Tuất Hữu
728	Hồng Hà
729	Thùy Tuấn
730	Hoa Lợi
731	Hợp Thoa
732	Tiến Thắm
733	Thương Sơn
734	Chiến Việt
735	Dì Nhàn
736	Mộc Hương
737	Lam Giang
738	Hoan Hường
739	chị thơm hải
740	An  Hùng
741	Thơm Tùng
742	Cafe 1999
743	tai oanh
744	hoa ly
745	nguyen thi mai
746	hop hiep
747	mơ chè
748	tu ngan
749	Dì Mười
750	Toàn Diệu
751	Cường hân
752	Gì Thủy Mậu
753	thúy hải
754	Quý Huy
755	Lệ Quyên
756	gi phúc
757	Nga Dương
758	Toàn Nguyệt
759	Bà Sửu Châu
760	đặng thị chinh
761	Minh uy
762	Dung Ất
763	Bà Thành
764	Phương Thuý
765	Nam Thắng
766	Bỉm sữa Tâm An
767	Nam Nhàn
768	Bình Hoa
769	Khải Hương
770	Chính Huyền
771	Hoàng Bách
772	Phương anh
773	Mơ Dũng
774	Âu Hiếu
775	Thương Nga
776	Thu Bảy
777	Mai Hương
778	Hùng Xuân
779	Thơ Hiệp
780	Vân Phú
781	Tài Trang
782	cafe Sơn Ngân
783	Lê Tuyến
784	Toàn Quỳnh
785	dung ất 2
786	Hải chi
787	Bà Hoa
788	Hoàng thành
789	Hương Vinh
790	Hông Khương
791	Hiệu Hiền
792	thùy hùng
793	Hải hoa
794	tạp hóa hương bảy
795	Nam thúy 1
796	Thắng Thương
797	trà sữa thái hoài
798	Đồng An
799	Vinh Anh
800	Phương Bình
801	Huyền bảy
802	Tấn Thành
803	Nam thúy
804	Nhuần Yến
805	Chiến Hưng
806	Chị Hồng
807	Mai chức
808	Nga Phúc
809	Dì Vinh
810	ngã ba quán
811	siêu thi trung Liên
812	Lâm hạnh
813	Cương Nghĩa
814	Thắng Cúc
815	Hồng Long
816	Thủy hoa
817	Cường Đào
818	Tường Huy
819	sỹ thuy
820	Gì Hoài Đại
821	Sâm Trung
822	Diện Hải
823	Hạnh Ngọ
824	Đông Chanh
825	Siêu Thị Vân Cường
826	Oanh Đồng
827	trà sữa tiamo
828	bà đáng
829	Vân Anh
830	Siêu Thị An Thanh
831	Mười Loan
832	Xuân Tinh
833	Chị Huệ
834	Bà Vinh
835	Tuyet Hung
836	Hà Hùng
837	AN ĐỀ
838	Hiền đường
839	Hoa Hùng
840	Hà Hoàng
841	Chị Long
842	Nhim baby
843	Anh Thơ
844	Lộc Lộc
845	Chị Liễu
846	tú quyết
847	Nhân Thương
848	tam tuat
849	kiên tuyết
850	thọ giang
851	công ty tnhh tm tổng hợp huy hiếu
852	Huynh Thi Thu Hien
853	Gì Thuận Mười
854	Hoàn Hương
855	xuân chinh
856	đại dương
857	kiên giang
858	Việt Lý
859	MINI MART SC 68
860	Gì Lài
861	Quang Hoa
862	Gì Sâm
863	Giang Hiếu
864	Cafe Hoa Phượng Đỏ
865	Hà Bé 2
866	Tuyết Toàn
867	Sỹ Điệp
868	Quỳnh Bình
869	Bình Linh
870	Chị Thơm
871	Lò Bánh Mì Bảo Khang
872	gì tâm long
873	Thanh Thùy
874	hoàng cầm
875	Mến Ứng
876	Minh Thường
877	Tuấn Hoàn
878	Quý Hòa
879	JuLy
880	Lâm Liên
881	Tuyết Thanh
882	Khuyên Danh
883	nguyên thị mai
884	Thủy Sáng
885	ánh tề
886	Minh Hà
887	Cúc Lam
888	ba minh
889	Bộ Lịnh
890	Chị Tuyết
891	Hiền Nhi
892	Thành Phượng
893	Minh Tiêu
894	Hà Đức
895	Dũng Hường
896	Dì Duyên
897	Bách Hoa Dừa
898	chi trang
899	24/7 Max
900	Chị Nhung
901	sáng sương
902	Ngọc Nguyệt
903	hường minh
904	Hoàng Anh CS2
905	trà chanh 1994
906	Mạnh Mến
907	Chị Yến
908	Chị  Giang
909	Minh Nga
910	Sửu Hòe
911	Bỉm sữa sơn hoài
912	Thành Hợp
913	Cường Mến
914	Dì Liên
915	Thành Hiền
916	trang thanh
917	Huyền Lân
918	Nhất Trí
919	Hoàng Hiền
920	Hạnh Quý
921	Mai Tám
922	Chị Hiền
923	Mẹ Bống
924	Chị Hiền Hội
925	Hà Thắng
926	Huệ Hoa
927	Trường Lài
928	Gì Lợi
929	Chè Thúy
930	Dì Liệu
931	Văn Lai
932	Hòa Thanh
933	Tiến Hương
934	phi yen
935	Lộc Hợi
936	Sơn  Khuyên
937	Chị Hà
938	Dì Hà
939	thóc gạo
940	Thảo Chi
941	Siêu Thị Hiền Hòa
942	Thắng  Hải
943	Lương Trọng
944	Việt Đường
945	Hải Tài
946	Thuận Phương
947	Nguyễn Thị Hồng
948	Nhuận Thanh
949	Chuỗi cửa hàng mẹ và bé
950	cafe Phong Lan
951	Huyền Thương
952	Mây Lương
953	Hương Lịch
954	Dung Sen Quyên
955	đặng thị hương
956	chị vân
957	quầy thuốc thư trinh
958	cà phê tino
959	ngoc phương
960	Cafe Linh Đan
961	Phương Cường
962	nguyễn văn hồng
963	chị thủy tuyen
964	Vinh Lý
965	Đức Giang
966	Thuốc Tây Chị Bình
967	Hải Bốn
968	Vi Phương Quý
969	Phúc Hoa
970	tạp hóa tùng khánh
971	Giải quyết khiếu nại
972	May Hà
973	quyết hoài
974	cô ba chòe
975	CÔNG TY TNHH ĐẦU TƯ KINH DOANH HOÀNG SƠN
976	tiến hà
977	bỉm sữa bảo anh
978	Tùng Lâm
979	vinh tho
981	hoa thương
982	chị BẰNG
983	KH  hưng huế
984	Chín Tùy
985	Thuong Hoi
986	kim thảo
987	mini mart
988	Phuong Gai
989	Lập Lan
990	c liễu sơn
991	KHO KỸ THUẬT K2 - CỤC HC-KT,QUÂN KHU 4
992	Tran Quang Trung
993	Hoan Huan
994	sữa bỉm truc quỳnh
995	Thom Thien
996	M&B BÉ MY
997	Tăng Văn Chí
998	Son Loc
999	ME BÉ INNOVA
1000	Lực Hồng
1001	Van Thanh
1002	cảnh chín
1003	Long Phương
1004	Võ Hạ
1005	Thủy Hữu
1006	Tai Anh
1007	Tinh Quy
1008	Nga Chinh
1009	Thành Thủy
1010	Phong Hương
1011	thu phong
1012	Dương Thị Vĩnh
1013	Hồng Tám
1014	Linh Anh
1015	Bs Đức Anh
1016	Trà sữa Boba
1017	Hưng Hiển
1018	bỉm sữa mẹ tép
1019	khu vui chơi đức duy
1020	Bùi thị Hiền
1021	Nga Dũng
1022	ca fe  long cuong
1024	Long Oanh
1025	Cửa hàng tổng hợp
1026	Phan Việt Phương
1027	Đào Điền
1028	Dương Póm
1029	Tuân Duyên
1030	Tư Thồn
1032	Thủy Dung
1033	Huệ Nam
1034	Mẹ Bé Cu Thóc
1035	Voi Coffee
1036	Dì Hồng
1037	Tiệm 1993
1038	Hiền Hồng
1039	Anh Em Quán
1040	Toàn Thủy
1041	Vượng Lý
1042	Lợi Điện
1043	Mằn Ỏn
1044	Moon coffee
1045	Bích Thủy
1046	Toàn Quế
1047	Minh Hường
1048	tạp hóa giang minh
1049	Việt Nam
1050	Lạng Đông
1052	Rê Lương
1053	Cafe Chơ
1054	Hương Mại
1055	nguyen thi thuy
1057	chi  phường dung
1058	Caffe Hai Map
1059	Quế Soa
1060	cà phê trà sữa dung thuận
1061	trạm coffee tea
1062	hải tuyết khoi tao cho toi cac cua hang nay. ma cua hang theo format CH-xxxx"""


def main():
    lines = RAW_DATA.strip().split("\n")
    items = []
    for line in lines:
        parts = line.split("\t")
        code_raw = parts[0].strip()
        name = parts[1].strip() if len(parts) > 1 else ""
        if code_raw == "1062" and "khoi tao" in name:
            name = name.split("khoi tao")[0].strip()

        code_formatted = f"CH-{int(code_raw):04d}"
        if not name:
            name = f"Cửa hàng CH-{int(code_raw):04d}"

        items.append((code_formatted, name))

    print(f"Tổng số cửa hàng cần import: {len(items)}")

    now = datetime.now(timezone.utc)
    inserted_count = 0
    updated_count = 0

    with engine.begin() as conn:
        for code, name in items:
            result = conn.execute(
                text("""
                    INSERT INTO stores (code, name, status, created_at)
                    VALUES (:code, :name, 'active', :created_at)
                    ON CONFLICT (code)
                    DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
                    RETURNING (xmax = 0) AS is_inserted
                """),
                {"code": code, "name": name, "created_at": now},
            )
            is_inserted = result.scalar()
            if is_inserted:
                inserted_count += 1
            else:
                updated_count += 1

    print(f"Hoàn thành khởi tạo cửa hàng:")
    print(f"- Số lượng thêm mới: {inserted_count}")
    print(f"- Số lượng cập nhật: {updated_count}")

    with engine.connect() as conn:
        total = conn.execute(text("SELECT count(*) FROM stores")).scalar()
        print(f"- Tổng số cửa hàng hiện có trong database: {total}")
        sample = conn.execute(text("SELECT id, code, name, status FROM stores ORDER BY code ASC LIMIT 5")).fetchall()
        print(f"- 5 cửa hàng đầu tiên: {sample}")
        sample_last = conn.execute(text("SELECT id, code, name, status FROM stores ORDER BY code DESC LIMIT 5")).fetchall()
        print(f"- 5 cửa hàng cuối cùng: {sample_last}")


if __name__ == "__main__":
    main()
