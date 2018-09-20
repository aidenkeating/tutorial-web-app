/* eslint class-methods-use-this: ["error", { "exceptMethods": ["isTransformable", "transform"] }] */
class DefaultServiceInstanceTransform {
  isTransformable() {
    return true;
  }

  transform(siInfo) {
    return {
      kind: 'ServiceInstance',
      metadata: {
        generateName: `${siInfo.name}-`,
        namespace: siInfo.namespace
      },
      spec: {
        clusterServiceClassExternalName: siInfo.name,
        clusterServicePlanExternalName: `default-${siInfo.name}`
      }
    };
  }
}

class AMQServiceInstanceTransform {
  isTransformable(siInfo) {
    return siInfo.name === DEFAULT_SERVICES.AMQ
  }

  transform(siInfo) {
    const defaultTransform = new DefaultServiceInstanceTransform().transform(siInfo);
    defaultTransform.spec.clusterServicePlanExternalName = 'default';
    return defaultTransform;
  }
}

class EnMasseServiceInstanceTransform {
  isTransformable(siInfo) {
    return siInfo.name === DEFAULT_SERVICES.ENMASSE;
  }

  transform(siInfo) {
    const defaultTransform = new DefaultServiceInstanceTransform().transform(siInfo);
    defaultTransform.spec.parameters = {
      name: siInfo.username
    };
    defaultTransform.spec.clusterServicePlanExternalName = 'unlimited-standard';
    return defaultTransform;
  }
}

const DEFAULT_SERVICES = {
  ENMASSE: 'enmasse-standard',
  AMQ: 'amq-broker-71-persistence',
  FUSE: 'fuse',
  CHE: 'che',
  LAUNCHER: 'launcher'
}
const DEFAULT_TRANSFORMS = [new EnMasseServiceInstanceTransform(), new AMQServiceInstanceTransform(), new DefaultServiceInstanceTransform()];

const buildServiceInstanceResourceObj = (siInfo, transforms = DEFAULT_TRANSFORMS) => {
  const transform = transforms.find(t => t.isTransformable(siInfo));
  if (!transform) {
    return null;
  }
  return transform.transform(siInfo);
};

export { buildServiceInstanceResourceObj, DefaultServiceInstanceTransform, EnMasseServiceInstanceTransform, DEFAULT_SERVICES };
