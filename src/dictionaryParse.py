import json

longestWord = 0
result = [[] for _ in range(15)]
    
with open('dictionary.txt', 'r') as f:
    for line in f:
        w = line.rstrip()
        result[len(w)-1].append(w)

json_object = json.dumps({'dictionary': result}, indent=4)
with open('dictionary.json', 'w') as outputFile:
    outputFile.write(json_object)