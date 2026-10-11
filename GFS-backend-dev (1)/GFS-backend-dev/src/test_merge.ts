const deepMergeSchema = (target: any, source: any, changedFieldPaths: string[], currentPath: string = '') => {
  if (typeof source !== 'object' || source === null) return;
  for (const key of Object.keys(source)) {
    if (key === '_meta' || key === 'pipeline_status' || key === 'project_id' || key === 'schema_version' || key === 'created_at' || key === 'updated_at') continue;
    
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    
    if (Array.isArray(source[key])) {
      target[key] = source[key];
      changedFieldPaths.push(newPath);
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      if (!target[key]) target[key] = {};
      deepMergeSchema(target[key], source[key], changedFieldPaths, newPath);
    } else {
      target[key] = source[key];
      changedFieldPaths.push(newPath);
    }
  }
};

const target = {
  stage_2: {
    _signals: {
      is_walkable: { value: null, status: 'PENDING' }
    }
  }
};

const source = {
  stage_2: {
    _signals: {
      is_walkable: {
        value: true,
        confidence: "MEDIUM",
        verbatim: "GLASS DECK"
      }
    }
  }
};

const changed: string[] = [];
deepMergeSchema(target, source, changed);
console.log(JSON.stringify(target, null, 2));
