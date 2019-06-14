
from itmlogic.hzns import hzns
from itmlogic.dlthx import dlthx

def qlrpfl(prop):
    """
    % Initialization routine for point-to-point mode

    """
    prop['dist'] = prop['pfl'][1] * prop['pfl'][2]

    np = prop['pfl'][1]

    prop['the'], prop['dl'] = (
        hzns(prop['pfl'], prop['dist'], prop['hg'], prop['gme'])
        )
    # print(prop)
    xl = {}
    for j in range(0,2):
        xl[j] = min(15 * prop['hg'][j], 0.1 * prop['dl'][j])

    xl[1]  = prop['dist'] - xl[1]
    
    prop['dh'] = dlthx(prop['pfl'], xl[0], xl[1])
    print(xl)
    # if (prop.dl(1)+prop.dl(2)>=1.5*prop.dist)
    # [za, zb]= zlsq1(prop.pfl,xl(1),xl(2));
    # prop.he(1)=prop.hg(1)+max(prop.pfl(3)-za,0);
    # prop.he(2)=prop.hg(2)+max(prop.pfl(np+3)-zb,0);
    # for j=1:2
    # prop.dl(j)=sqrt(2.*prop.he(j)/prop.gme)*exp(-0.07*sqrt(prop.dh/max(prop.he(j),5.)));
    # end
    # q=prop.dl(1)+prop.dl(2);
    # if (q<=prop.dist)
    # q=(prop.dist/q)^2;
    # for j=1:2
    #     prop.he(j)=prop.he(j)*q;
    #     prop.dl(j)=sqrt(2.*prop.he(j)/prop.gme)*exp(-0.07*sqrt(prop.dh/max(prop.he(j),5.)));
    # end
    # end
    # for j=1:2
    # q=sqrt(2.*prop.he(j)/prop.gme);
    # prop.the(j)=(0.65*prop.dh*(q/prop.dl(j)-1.)-2.*prop.he(j))/q;
    # end

    # else
    # [za, q]=zlsq1(prop.pfl,                   xl(1),0.9*prop.dl(1));
    # [q, zb]=zlsq1(prop.pfl,prop.dist-0.9*prop.dl(2),    xl(2));
    # prop.he(1)=prop.hg(1)+max(prop.pfl(3)-za,0);
    # prop.he(2)=prop.hg(2)+max(prop.pfl(np+3)-zb,0);
    # end

    # prop.mdp=-1;
    # prop.lvar=max(prop.lvar,3);
    # if (prop.mdvarx>=0)
    # prop.mdvar=prop.mdvarx;
    # prop.lvar=max(prop.lvar,4);
    # end

    # if (prop.klimx>0)
    # prop.klim=prop.klimx;
    # prop.lvar=5;
    # end

    # %call lrprop(0.)

    # [prop]=lrprop(0.,prop );

    return prop
