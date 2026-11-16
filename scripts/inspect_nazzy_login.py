import httpx
import re

with httpx.Client(verify=False, timeout=15.0) as client:
    r = client.get("http://dms21.nazzy.vn/", follow_redirects=True)
    print("Final URL:", r.url)
    print("Status code:", r.status_code)
    
    # Tìm các input
    inputs = re.findall(r'<input[^>]+>', r.text, re.IGNORECASE)
    print(f"Inputs count: {len(inputs)}")
    for inp in inputs:
        print(" ", inp)
        
    # Tìm handler / ajax / api
    matches = set(re.findall(r'(\w+Handler\.ashx\?[^\'\"\`\s>]+)', r.text))
    print("Handlers found:", matches)
    
    # Tìm các link script
    scripts = re.findall(r'src=["\']([^"\']+\.js[^"\']*)["\']', r.text)
    print("Scripts:")
    for s in scripts:
        print(" ", s)
